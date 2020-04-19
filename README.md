# Segwit Calculations with Blockstream API 

## Prerequisites

Dependency manager and runtime:

- `yarn`
- `node v12`

Beyond this, you will also need:

1. An Airtable base with a table which has the following columns (all type: number) named exactly as follows:
   block_time 
   block_height 
   block_saved
   block_fee
   real_weight
   real_size
   new_weight
   new_size
   
2. A `.env` file at project root with the following entries:
   AIRTABLE_API_KEY=your_airtable_api_key
   AIRTABLE_BASE=your_airtable_base_string
   AIRTABLE_TABLE=your_airtable_table_string

### How to use:

1. `git clone` this repo
2. `cd` into the project dir this creates
3. `yarn` to install dependencies
4. execute `node segwit.js --startAtBlock=SOME_BLOCK_HEIGHT --stopAtBlock=SOME_SMALLER_BLOCK_HEIGHT` to run the program
   NOTE: `--startAtBlock` is optional. Forgoing this arg will start the scan from the latest top of the chain.

The program will work its way down the block chain from the startAtBlock until stopAtBlock.
