// the following script will normalize transaction object to compatbile with insight explorer code
// add a path to file with transactions object literal e.g. {tx1: {}, tx2: {}}
// each transaction must be in komodod getrawtransaction 1 output format
var txs = require('./'); 

var keys = Object.keys(txs);
for (var i = 0; i < keys.length; i++) {
  txs[keys[i]].inputs = txs[keys[i]].vin;
  txs[keys[i]].outputs = txs[keys[i]].vout;
  delete txs[keys[i]].vin;
  delete txs[keys[i]].vout;

  for (var j = 0; j < txs[keys[i]].inputs.length; j++) {
    txs[keys[i]].inputs[j].satoshis = txs[keys[i]].inputs[j].valueSat;
  }

  for (var j = 0; j < txs[keys[i]].outputs.length; j++) {
    txs[keys[i]].outputs[j].scriptAsm = txs[keys[i]].outputs[j].scriptPubKey.asm;
    txs[keys[i]].outputs[j].script = txs[keys[i]].outputs[j].scriptPubKey.hex;
    txs[keys[i]].outputs[j].satoshis = txs[keys[i]].outputs[j].valueSat;
    if (txs[keys[i]].outputs[j].scriptPubKey.addresses) txs[keys[i]].outputs[j].address = txs[keys[i]].outputs[j].scriptPubKey.addresses[0];
  }
}

console.log(JSON.stringify(tx, null, 2));