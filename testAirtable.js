require('dotenv').config()
const fetch = require('node-fetch')
const Airtable = require('airtable')
const _ = require('lodash')
const retry = require('async-retry')

// check if we have the proper environment variables
if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE) {
  throw new Error(`
    In order to properly run the coinjoin volume analyzer you need a few things.

      1. You need to have a .env file with the following entries:
        AIRTABLE_API_KEY=your_airtable_api_key
        AIRTABLE_BASE=your_airtable_base_string
        AIRTABLE_TABLE=your_airtable_table_string

      2. You need have An Airtable base with a table which has the following columns (all type: number) named exactly as follows:
        block_time 
        block_height 
        block_saved
        block_fee
        real_weight
        real_size
        new_weight
        new_size
  `)
}

// Setup Airtable Connection
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE)

main()

async function main() {
  const transactionInformation = {
    txid: 5555,
  }

  const batch = Array(10).fill({ fields: transactionInformation })

  await base('test').create(batch, (err, records) => {
    if (err) {
      console.error(err)
      return
    }
    records.forEach(function(record) {
      console.log(`airtable record saved:${record.getId()} for data of txid: ${record.fields.txid}`)
    })
  })
}
