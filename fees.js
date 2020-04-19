require('dotenv').config()
const fetch = require('node-fetch')
const Airtable = require('airtable')
const _ = require('lodash')
const retry = require('async-retry')
const colors = require('colors/safe')

const DescriptiveError = new Error(
  colors.magenta(`

    In order to properly run the coinjoin volume analyzer you need a couple things.

      1. You need have An Airtable base with a table which has the following columns (all type: number) named exactly as follows:
        block_time 
        block_height 
        block_saved
        block_fee
        real_weight
        real_size
        new_weight
        new_size

      2. A .env file at project root with the following entries:
        AIRTABLE_API_KEY=your_airtable_api_key
        AIRTABLE_BASE=your_airtable_base_string
        AIRTABLE_TABLE=your_airtable_table_string

  `),
)

// check if we have the proper environment variables
if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE || !process.env.AIRTABLE_TABLE) {
  throw DescriptiveError
}

// Setup Airtable Connection
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE)

// Blockstream API host
const blockstreamApi = 'https://blockstream.info/api'

// cost of p2sh type of transactions
const P2SH_P2WPKH_COST = 21 * 4 // the WU cost for the non-witness part of P2SH-P2WPKH
const P2SH_P2WSH_COST = 35 * 4 // the WU cost for the non-witness part of P2SH-P2WSH

// Utilities for segwitFeeGains
const witnessSize = vin => vin.witness.reduce((S, w) => S + w.length / 2, 0)
const scriptSigSize = vin => (vin.scriptsig ? vin.scriptsig.length / 2 : 0)

// Extracting args
const args = require('minimist')(process.argv.slice(2))
const stopAtBlock = args['stopAtBlock']
const startAtBlock = args['startAtBlock']
if (!stopAtBlock) {
  console.log(
    colors.magenta(`
      In order to run the coinjoin volume analyzer you must provide:
      the block height you want the scan to stop at (--stopAtBlock)
      
      Optional: you can also pass the block height at which you want to start the scan (--startAtBlock)
      If ommitted the scan will start with the latest block.

      examples: 
        'node segwit.js --startAtBlock=617246 --stopAtBlock=612913'
        'node segwit.js --stopAtBlock=617823'

      To obtain the last block height you have data for, sort your airtable by block_height.
    `),
  )
  return
}

main(startAtBlock)

/**
 *  Main Function
 *
 *  Will start scanning the block chain from the startAtBlock block backward until the "stopAtBlock" height.
 *
 *  Program flow:
 *  1. Grab 10 blocks (We need the hashes and the tx_count)
 *  2. For each block we:
 *    3. Grab 25 transactions and for each transactions we:
 *       4. Check the scriptpubkey type of each input and calculate their hypothetical weight and size
 *       5. substract the weight and size loss from the existant block_weight and block_size
 *       6. by calculating the percentage of weight_space_saved, we can calculate how much can be saved in fees too.
 *  6. Repeat from the top for next 10 blocks.
 *
 */
async function main(scanFromHeight) {
  if (!scanFromHeight) {
    // Get blockchain tip to start scan
    scanFromHeight = await retry(() => fetch(`${blockstreamApi}/blocks/tip/height`).then(res => res.json()))
  }

  // Get 10 latest blocks:
  let batchOf10Blocks = await retry(() => fetch(`${blockstreamApi}/blocks/${scanFromHeight}`).then(res => res.json()))
  // Inititalize flag for stopBlockSeen
  let stopBlockSeen = false

  // If the stopBlock is in this batch, we set stopBlockSeen flag to true and slice the batch to remove all block after stopBlock
  const stopBlockIndex = _.findIndex(batchOf10Blocks, block => block.height === stopAtBlock)
  if (stopBlockIndex > -1) {
    stopBlockSeen = true
    batchOf10Blocks = _.slice(batchOf10Blocks, 0, stopBlockIndex)
  }

  await asyncForEach(batchOf10Blocks, async block => {
    console.log('\n%cblock.height', 'color:orange;font-weight:bold;', block.height)

    const blockFee = await getBlockfee(block.id)
    // Queue for block data to ship to airtable.
    const blockData = {
      block_time: block.timestamp,
      block_height: block.height,
      block_fee: blockFee,
      real_weight: block.weight,
      real_size: block.size,
      block_saved: 0,
      new_weight: block.weight,
      new_size: block.size,
    }

    async function processTxBatch(startIndex) {
      // if startIndex greater than tx_count we have scanned the whole block so gtfo
      if (startIndex > block.tx_count - 1) {
        return
      }

      const batchOfTx = await retry(() =>
        fetch(`${blockstreamApi}/block/${block.id}/txs/${startIndex}`).then(res => res.json()),
      )

      // if no transactions returned gtfo
      if (!batchOfTx || batchOfTx.length < 1) {
        return
      }

      await asyncForEach(batchOfTx, async tx => {
        const segwitSaved = calcSegwitFeeGains(tx)
        if (typeof(tx.fee) === 'number' ) { 
        blockData.block_saved += tx.fee * segwitSaved.potentialBech32Gains
      } 
        blockData.new_weight -= segwitSaved.txWeightLoss
        blockData.new_size -= segwitSaved.txSizeLoss
      })

      // Process the next Batch of transactions in this block
      await processTxBatch(startIndex + 25)
    }

    // we ship the info for the block here
    await processTxBatch(0)

    console.log('\n', `Finished block ${block.height}`, '\n')
    console.log('Writing the following payload to airtable', blockData, '...\n')
    // You must shape the data as expected by `writeToAirtable`
    await writeToAirtable([{ fields: { ...blockData } }])
  })

  // if seen stopBlock gtfo of main loop, we are done.
  if (stopBlockSeen) {
    console.log('\n Stop Block was observed in this batch, shut it down because we have all the newest data. \n')
    return
  }

  await main(scanFromHeight - 10)
}

// =============================
//       HELPER FUNCTIONS
// =============================

/**
 * Write data to Airtable
 *
 * Payload MUST be array of shape:
 *  [
 *    { fields: { ...yourData } },
 *    { fields: { ...yourData } },
 *  ]
 *  */
async function writeToAirtable(payload) {
  // Airtable only allows for batching 10 records at a time so we chunk
  await asyncForEach(chunk(payload, 10), async batch => {
    // Create the records for this batch of 10
    await base(process.env.AIRTABLE_TABLE).create(batch, (err, records) => {
      if (err) {
        if (err.statusCode === 422) {
          console.error(err.message)
          console.error(err)
          throw DescriptiveError
        }
        console.error(err)
        return
      }
      records.forEach(function(record) {
        console.log(`airtable record saved.`)
      })
    })
  })
}

async function getBlockfee(id) {
  // api to get the first transaction
  // return the vout amount - 12.5
  const batchOfTx = await retry(() => fetch(`${blockstreamApi}/block/${id}/txs`).then(res => res.json()))
  let sum = 0;
  for (const vout of batchOfTx[0].vout) {
    if (typeof(vout.value) === 'number' ) { 
      sum += vout.value
    }
  }

// Get the realized and potential fee savings of segwit for the given tx
function calcSegwitFeeGains(tx) {
  // calculated in weight units
  let weightLoss = 0
  let sizeLoss = 0

  for (const vin of tx.vin) {
    if (!vin.prevout) continue

    const isP2pkh = vin.prevout.scriptpubkey_type == 'p2pkh'
    const isP2sh = vin.prevout.scriptpubkey_type == 'p2sh'
    const isP2wsh = vin.prevout.scriptpubkey_type == 'v0_p2wsh'
    const isP2wpkh = vin.prevout.scriptpubkey_type == 'v0_p2wpkh'

    const op = vin.scriptsig ? vin.scriptsig_asm.split(' ')[0] : null
    const isP2sh2Wpkh = isP2sh && !!vin.witness && op == 'OP_PUSHBYTES_22'
    const isP2sh2Wsh = isP2sh && !!vin.witness && op == 'OP_PUSHBYTES_34'

    switch (true) {
      // Native Segwit - P2WPKH/P2WSH (Bech32)
      case isP2wpkh:
      case isP2wsh:
        // maximal gains: the scriptSig is moved entirely to the witness part
        break

      // Backward compatible Segwit - P2SH-P2WPKH
      case isP2sh2Wpkh:
        // the scriptSig is moved to the witness, but we have extra 21 extra non-witness bytes (48 WU)
        weightLoss += P2SH_P2WPKH_COST
        sizeLoss += 21
        break

      // Backward compatible Segwit - P2SH-P2WSH
      case isP2sh2Wsh:
        // the scriptSig is moved to the witness, but we have extra 35 extra non-witness bytes
        weightLoss += P2SH_P2WSH_COST
        sizeLoss += 35
        break

      // Non-segwit P2PKH/P2SH
      case isP2pkh:
      case isP2sh:
        const fullGains = scriptSigSize(vin) * 3
        weightLoss += fullGains
        break
    }
  }
  // console.log(`${tx.txid} ${potentialBech32Gains} ${tx.weight}`)
  // returned as percentage of the total tx weight
  if (tx.weight == 0) {
    console.log('\n%ctx.weight IS ZERO !', 'color:orange;font-weight:bold;', tx.weight, '\n\n')
  }
  return {
    potentialBech32Gains: weightLoss / tx.weight,
    txWeightLoss: weightLoss,
    txSizeLoss: sizeLoss,
  }
}

// Async forEach which awaits every loop to be complete before proceeding to next
async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array)
  }
}

// Chunk an array into pieces recursively
const chunk = function(array, size) {
  if (!array.length) {
    return []
  }
  const head = array.slice(0, size)
  const tail = array.slice(size)

  return [head, ...chunk(tail, size)]
}

// sleep for X milliseconds
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
