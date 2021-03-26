'use strict';

var async = require('async');
var fs = require('fs');
var bitcore = require('bitcore-lib-komodo');

var Common = require('./common');
var helpers = require('./math-helpers');

var TIP_SYNC_INTERVAL = 10;
var SKIP_OP_CHECKCRYPTOCONDITION = false;
var MEMPOOL_SYNC_INTERVAL = 2; // seconds
var RESTART_PAST_BLOCKS_LOOKUP = 5;
var isRestarted = true;

// TODO: split balance in conf and unconf

var onchainDexTx = [];
var onChainHoldAddress = 'RTWtxY7GTBZ3zL8jfzyWWz1fveF3KXKBF8';
var rawMempool = [];

function TokensController(node) {
  this.node = node;
  this.commonCache = this.node.configPath.replace('bitcore-node.json', 'tokens-common.json');
  this.addressesIndex = this.node.configPath.replace('bitcore-node.json', 'tokens-addresses.json');
  this.processedTransactionsIndex = this.node.configPath.replace('bitcore-node.json', 'tokens-processed-transactions.json');
  this.common = new Common({log: this.node.log});
  this.cache = {
    lastBlockChecked: 0,
    processedTransactionsIndex: [],
    tokens: {},
    tokenOrderbook: [],
    tokenOrders: {},
    tokenOrdersFlat: [],
  };
  this.computed = {
    addresses: [],
  };
  this.currentBlock = 1;
  this.lastBlockChecked = 1;
  this.tokensSyncInProgress = false;
  this.dataDumpInProgress = false;
  this.lastBlockProcessedTime = 0;
}

TokensController.prototype.showSyncProgress = function(req, res) {
  res.jsonp({
    progress: {
      chainTip: this.currentBlock,
      lastBlockChecked: this.lastBlockChecked,
      progress: Number(this.lastBlockChecked * 100 / this.currentBlock).toFixed(2),
    }
  });
};

TokensController.prototype.kickStartSync = function() {
  // ref: https://github.com/pbca26/komodolib-js/blob/interim/src/time.js
  var currentEpochTime = Date.now() / 1000;
  var secondsElapsed = Number(currentEpochTime) - Number(this.lastBlockProcessedTime / 1000);

  if (Math.floor(secondsElapsed) > 60) {
    this.node.log.info('kickstart tokens sync');
    this.tokensSyncInProgress = false;
  }
};

TokensController.prototype.startSync = function() {
  var self = this;

  try {
    var localCacheRaw = fs.readFileSync(self.commonCache, 'UTF-8');
    this.cache = JSON.parse(localCacheRaw);
    this.tokenOrdersFlat = [''];
    this.lastBlockChecked = this.cache.lastBlockChecked + 1;
  } catch (e) {
    self.node.log.info(e);
  }

  this.node.services.bitcoind.getInfo(function(err, result) {
    if (!err) {
      self.node.log.info('sync getInfo', result);
      self.currentBlock = result.blocks;
      self.node.log.info('tokens sync: ' + self.tokensSyncInProgress);
      if (!self.tokensSyncInProgress) {
        self.syncTokenInfo().then(function() {
          self.syncMempool().then(function() {
            if (rawMempool.length) {
              self.syncTokenInfo();
              self.syncTokenOrderbook();
              self.syncBlocks(true);
            } else {
              self.syncTokenInfo();
              self.syncTokenOrderbook();
              self.syncBlocks();
            }
          });
        });
      }
    }
  });

  setInterval(() => {
    this.node.services.bitcoind.getInfo(function(err, result) {
      if (!err) {
        self.node.log.info('sync getInfo', result);
        self.currentBlock = result.blocks;
        self.kickStartSync();
        self.node.log.info('tokens sync: ' + self.tokensSyncInProgress);
        if (!self.tokensSyncInProgress) {
          self.syncTokenInfo().then(function() {
            self.syncMempool().then(function() {
              if (rawMempool.length) {
                self.syncTokenInfo();
                self.syncTokenOrderbook();
                self.syncBlocks(true);
              } else {
                self.syncTokenInfo();
                self.syncTokenOrderbook();
                self.syncBlocks();
              }
            });
          });
        }
      }
    });
  }, TIP_SYNC_INTERVAL * 1000);

  setInterval(() => {
    if (!self.dataDumpInProgress) {
      fs.writeFile(self.commonCache, JSON.stringify(self.cache), function (err) {
        if (err) self.node.log.info(err);
        self.node.log.info('tokens cache file updated');
      });
    }
  }, 5 * 1000);
};

TokensController.prototype.syncBlocks = function(syncFromMempool) {
  var self = this;

  if (syncFromMempool) {
    self.node.log.info('tokens sync from mempool ' + rawMempool.length + ' txs');
  } else {
    self.node.log.info('tokens sync start at ht. ' + self.lastBlockChecked);
  }

  var checkBlock = function(height) {
    if (height <= self.currentBlock || syncFromMempool) {
      self.tokensSyncInProgress = true;
      self.lastBlockProcessedTime = Date.now();

      self.node.log.info('tokens sync at ht. ' + self.lastBlockChecked);

      self.node.services.bitcoind.getBlockOverview(height, function(err, block) {
        if (!err) {
          //self.node.log.info('block', block);
          var txids = syncFromMempool ? rawMempool : block.txids;
          
          async.eachOfSeries(txids, (txid, ind, callback) => {
            self.node.services.bitcoind.getDetailedTransaction(txid, function(err, transaction) {
              console.log(transaction);
              
              if (!err) {
                var isCCTX = false;
                //self.node.log.info('tx ' + txid, transaction);
                
                for (var i = 0; i < transaction.outputs.length; i++) {

                  if (transaction.outputs[i].scriptAsm &&
                      transaction.outputs[i].scriptAsm.indexOf('OP_CHECKCRYPTOCONDITION') > -1) {
                    isCCTX = true;
                    break;
                    //self.node.log.info('tx ' + txid, 'OP_CHECKCRYPTOCONDITION');
                  }
                }

                if (isCCTX) {
                  console.log('CC TX');

                  // parse tokencreate tx if in mempool
                  var contractScript = transaction.outputs[transaction.outputs.length - 1].scriptAsm;
                  console.log('script', contractScript);

                  if (contractScript.indexOf('OP_RETURN ') > -1) {
                    contractScript = contractScript.substr(10, contractScript.length);
                    console.log('script', contractScript);

                    if (contractScript.indexOf('f26321') > -1) {
                      contractScript = contractScript.substr(6, contractScript.length);
                      console.log('script', contractScript);
                    }
                    if (contractScript.indexOf('f2430121') > -1) {
                      contractScript = contractScript.substr(8, contractScript.length);
                      console.log('script', contractScript);
                    }
                    contractScript = contractScript.substr(66, contractScript.length);
                    contractScript = contractScript.substr(2, contractScript.length);
                    console.log('token hex', contractScript);
                    var delimByte = ['0f', '0c', '06', '08', '09', '10', '11', '12', '13', '14'];
                    var delimNFTByte = ['6af5', '6af7', '6af6'];

                    for (var z = 0; z < delimByte.length; z++) {
                      try {
                        if (contractScript.indexOf(delimByte[z]) > -1) {
                          console.log(contractScript.substr(0, contractScript.indexOf(delimByte[z])))
                          var contractName = Buffer.from(contractScript.substr(0, contractScript.indexOf(delimByte[z])), 'hex').toString().trim();
                          var contractDesc = Buffer.from(contractScript.substr(contractScript.indexOf(delimByte[z]), contractScript.length), 'hex').toString().trim();
                          var contractNFTData;

                          for (var n = 0; n < delimNFTByte.length; n++) {
                            var tempDesc = contractScript.substr(contractScript.indexOf(delimByte[z]), contractScript.length);
                            
                            if (tempDesc.indexOf(delimNFTByte[n]) > -1) {
                              console.log('delim nft');
                              console.log(tempDesc.substr(0, tempDesc.indexOf(delimNFTByte[n])))
                              contractDesc = Buffer.from(tempDesc.substr(0, tempDesc.indexOf(delimNFTByte[n])), 'hex').toString().trim();
                              contractNFTData = tempDesc.substr(tempDesc.indexOf(delimNFTByte[n]) + delimNFTByte[n].length, tempDesc.length);
                              console.log(contractNFTData)

                              contractNFTData = {
                                raw: contractNFTData,
                                decoded: JSON.parse(Buffer.from(contractNFTData, 'hex').toString().trim()),
                              };
                            }
                          }

                          var contractSupply = transaction.outputs[1].satoshis;
                          var contractOwner = transaction.outputs[2].scriptAsm.substr(0, 66);
                          var contractOwnerAddress = new bitcore.PublicKey(contractOwner, {network: bitcore.Networks.kmdnet}).toAddress().toString();

                          console.log('name', contractName);
                          console.log('desc', contractDesc);
                          console.log('supply', contractSupply);
                          console.log('owner ' + contractOwner + ' | ' + contractOwnerAddress);
                          console.log('nft data', contractNFTData);

                          //if (!self.cache.tokens[txid]) {
                            self.cache.tokens[txid].tokenInfo = {
                              blockhash: -1,
                              blocktime: -1,
                              description: contractDesc,
                              height: -1,
                              name: contractName,
                              owner: contractOwner,
                              ownerAddress: contractOwnerAddress,
                              supply: contractSupply,
                              syncedHeight: 0,
                              tokenid: txid,
                              data: contractNFTData,
                            };
                          //}
                        }
                      } catch (e) {
                        console.log(e)
                        console.log('unable to decode contract ' + txid);
                      }
                    }
                  }

                  for (let cc = 0; cc < Object.keys(self.cache.tokens).length; cc++) {
                    const ccId = Object.keys(self.cache.tokens)[cc];
                    let isCCTransfer = false, isCCOnChainDexOrder = false, fillOrder = false, cancelOrder = false;
                    let value = [], receiver = [], sender, fundingTx; // TODO: append funging tx to tx history
    
                    //if (!self.cache.tokens) self.cache.tokens[chain] = {};
                    //if (!self.cache.tokens[ccId]) self.cache.tokens[ccId] = {};
                    if (!self.cache.tokens[ccId].addresses) self.cache.tokens[ccId]['addresses'] = {};
                    if (!self.cache.tokens[ccId].balances) self.cache.tokens[ccId]['balances'] = {};
                    if (!self.cache.tokens[ccId].transactions) self.cache.tokens[ccId]['transactions'] = {};
                    if (!self.cache.tokens[ccId].transactionsAll) self.cache.tokens[ccId]['transactionsAll'] = {};
                    if (!self.cache.tokens[ccId].dexTrades) self.cache.tokens[ccId]['dexTrades'] = {};
                    if (!self.cache.tokens[ccId].dexTradesStats) self.cache.tokens[ccId]['dexTradesStats'] = {
                      count: 0,
                      volume: 0,
                    };
                    
                    for (let a = 0; a < transaction.outputs.length; a++) {
                      if (transaction.outputs[a].scriptAsm.indexOf('OP_CHECKCRYPTOCONDITION') > -1) {
                        //console.log('CC VOUT n=' + transaction.outputs[a].n);
                        console.log('CC VOUT val=' + transaction.outputs[a].satoshis);
                        value.push(transaction.outputs[a].satoshis);
                        console.log('CC VOUT ccaddress=' + transaction.outputs[a].address);
                        receiver.push(transaction.outputs[a].address);
                      }
    
                      if (transaction.outputs[a].scriptAsm.indexOf(ccId) > -1) {
                        isCCTransfer = true;
                        console.log('CC token transfer ' + ccId);
                        console.log('CC token transfer destpub=' + (transaction.outputs[a].script.substr(transaction.outputs[a].script - 66, 66)));
                        try {
                          console.log('CC token transfer destpubaddress=' + new bitcore.PublicKey(transaction.outputs[a].script.substr(transaction.outputs[a].script.length - 66, 66), {network: bitcore.Networks.livenet}).toAddress().toString());
                        } catch (e) {
                          console.log(e);
                        }
                      }
                    }
    
                    if (transaction.inputs.length === 2 || (transaction.inputs.length === 3 && transaction.outputs[0].satoshis === 0 && transaction.outputs.length >= 4)) {
                      isCCOnChainDexOrder = false;
                    } else {
                      isCCOnChainDexOrder = true;
                    }

                    // sell order
                    if (transaction.inputs.length === 2 && transaction.outputs[0].address === onChainHoldAddress && transaction.outputs.length >= 4) {
                      console.log('CC token onchain exchange ' + ccId);
                      //isCCOnChainDexOrder = true;
                      onchainDexTx.push({type: 'sell', ccId: ccId});
                    }

                    if (transaction.inputs[1] && transaction.inputs[1].address === onChainHoldAddress && transaction.outputs[0] && transaction.outputs[0].address === onChainHoldAddress) {
                      fillOrder = true;
                      console.log('onchain dex fill order ' + ccId);
                      onchainDexTx.push({type: 'fill', ccId: ccId});
                      // mapping: vout1 - change, vout2 how much is bought (sats to number), vout3 how much main chain was paid for order
                    }

                    if (transaction.inputs[1] && transaction.inputs[1].address == onChainHoldAddress && transaction.outputs[0] && transaction.outputs[0].address != onChainHoldAddress) {
                      cancelOrder = true;
                      console.log('onchain dex cancel order ' + ccId);
                      onchainDexTx.push({type: 'cancel', ccId: ccId});
                      // mapping: vout1 - change, vout2 how much is bought (sats to number), vout3 how much main chain was paid for order
                    }

                    //if (transaction.outputs[0]. && transaction.outputs[0].address)
                    //console.log(transaction.inputs.length + ' / ' + transaction.outputs[0].address + ' / ' + transaction.outputs.length);
    
                    if (isCCTransfer) {
                      if (!isCCOnChainDexOrder &&
                          transaction.inputs[1] &&
                          transaction.inputs[1].hasOwnProperty('address') &&
                          (process.argv.indexOf('reindex') > -1 || (process.argv.indexOf('reindex') === -1 && self.cache.tokenOrdersFlat && self.cache.tokenOrdersFlat.indexOf(txid) === -1))) {
                        /*if (transaction.inputs.length === 3 && transaction.outputs[0].satoshis === 0 && transaction.outputs.length >= 4) {
                          console.log('CC DEX buy from ' + transaction.inputs[2].address + ' at price ' + helpers.fromSats(transaction.inputs[1].satoshis) + ', tokens received ' + transaction.outputs[2].satoshis + ' to address ' + transaction.outputs[2].address);*/
                        if (fillOrder) {
                          console.log('CC DEX buy from ' + transaction.inputs[1].address + ' at price ' + (helpers.fromSats(transaction.outputs[2].satoshis) / transaction.outputs[1].satoshis) + ', tokens received ' + transaction.outputs[1].satoshis + ' to address ' + transaction.outputs[1].address);
                            
                          sender = transaction.inputs[1].address;
                          receiver[0] = transaction.outputs[1].address;
                          value[0] = transaction.outputs[1].satoshis;
    
                          if (Object.keys(self.cache.tokens[ccId].dexTrades).indexOf(txid) === -1) {
                            self.cache.tokens[ccId].dexTrades[txid] = {
                              from: sender,
                              to: receiver[0],
                              value: value[0],
                              //confirmations: rawtx.result.confirmations,
                              //rawconfirmations: rawtx.result.rawconfirmations,
                              height: syncFromMempool ? -1 : transaction.height,
                              blockhash: syncFromMempool ? -1 : transaction.blockHash,
                              txid: txid,
                              time: syncFromMempool ? -1 : transaction.blockTimestamp,
                              price: helpers.fromSats(transaction.outputs[2].satoshis) / transaction.outputs[1].satoshis,
                              type: 'fill',
                              tokenid: ccId,
                            };

                            self.cache.tokens[ccId].dexTradesStats.count++;
                            self.cache.tokens[ccId].dexTradesStats.volume += value[0];
                          }
                        } else if (cancelOrder) {
                          console.log('CC DEX cancel order from ' + transaction.inputs[1].address + ', ' + transaction.outputs[0].satoshis + ' tokens received back to address ' + transaction.outputs[0].address);
                          
                          sender = transaction.inputs[1].address;
                          receiver[0] = transaction.outputs[0].address;
                          value[0] = transaction.outputs[0].satoshis;
    
                          if (Object.keys(self.cache.tokens[ccId].dexTrades).indexOf(txid) === -1) {
                            self.cache.tokens[ccId].dexTrades[txid] = {
                              from: sender,
                              to: receiver[0],
                              value: value[0],
                              //confirmations: rawtx.result.confirmations,
                              //rawconfirmations: rawtx.result.rawconfirmations,
                              height: syncFromMempool ? -1 : transaction.height,
                              blockhash: syncFromMempool ? -1 : transaction.blockHash,
                              txid: txid,
                              time: syncFromMempool ? -1 : transaction.blockTimestamp,
                              type: 'cancel',
                              tokenid: ccId,
                            };
                          }
                        } else {
                          console.log('CC token transfer from ' + transaction.inputs[1].address);
                          sender = transaction.inputs[1].address;
                        }
    
                        if (Object.keys(self.cache.tokens[ccId].addresses).indexOf(sender) === -1) self.cache.tokens[ccId].addresses[sender] = [];
                        if (Object.keys(self.cache.tokens[ccId].addresses).indexOf(receiver[0]) === -1) self.cache.tokens[ccId].addresses[receiver[0]] = [];
                        if (Object.keys(self.cache.tokens[ccId].balances).indexOf(sender) === -1) self.cache.tokens[ccId].balances[sender] = 0;
                        if (Object.keys(self.cache.tokens[ccId].balances).indexOf(receiver[0]) === -1) self.cache.tokens[ccId].balances[receiver[0]] = 0;
                        
                        if (sender !== receiver[0] && Object.keys(self.cache.tokens[ccId].transactionsAll).indexOf(txid) === -1) {
                          self.cache.tokens[ccId].balances[sender] -= Number(value[0]);
                          self.cache.tokens[ccId].balances[receiver[0]] += Number(value[0]);
                        }
    
                        if (Object.keys(self.cache.tokens[ccId].transactionsAll).indexOf(txid) === -1 || (Object.keys(self.cache.tokens[ccId].transactionsAll).indexOf(txid) > -1 && self.cache.tokens[ccId].transactionsAll[txid].height === -1)) {
                          self.cache.tokens[ccId].transactionsAll[txid] = {
                            from: sender,
                            to: receiver[0],
                            value: value[0],
                            //confirmations: rawtx.result.confirmations,
                            //rawconfirmations: rawtx.result.rawconfirmations,
                            height: syncFromMempool ? -1 : transaction.height,
                            blockhash: syncFromMempool ? -1 : transaction.blockHash,
                            txid: txid,
                            time: syncFromMempool ? -1 : transaction.blockTimestamp,
                          };
                        }
    
                        if (!self.cache.tokens[ccId].transactions[sender]) self.cache.tokens[ccId].transactions[sender] = [];
                        if (self.cache.tokens[ccId].addresses[sender].indexOf(txids) === -1) {
                          self.cache.tokens[ccId].addresses[sender].push(txids);
                        }
    
                        if (self.cache.tokens[ccId].transactions[sender].indexOf(txid) === -1 || (self.cache.tokens[ccId].transactions[sender].indexOf(txid) > -1 && self.cache.tokens[ccId].transactions[sender][txid].height === -1)) {
                          self.cache.tokens[ccId].transactions[sender].push({
                            from: sender,
                            to: receiver[0],
                            value: value[0],
                            //confirmations: rawtx.result.confirmations,
                            //rawconfirmations: rawtx.result.rawconfirmations,
                            height: syncFromMempool ? -1 : transaction.height,
                            blockhash: syncFromMempool ? -1 : transaction.blockHash,
                            txid: txid,
                            time: syncFromMempool ? -1 : transaction.blockTimestamp,
                          });
                        }
    
                        if (!self.cache.tokens[ccId].transactions[receiver[0]]) self.cache.tokens[ccId].transactions[receiver[0]] = [];
                        if (sender !== receiver[0] && self.cache.tokens[ccId].addresses[receiver[0]].indexOf(txid) === -1) {
                          self.cache.tokens[ccId].addresses[receiver[0]].push(txid);
                        }
    
                        if (sender !== receiver[0]) {
                          if (self.cache.tokens[ccId].transactions[receiver[0]].indexOf(txid) === -1 || (self.cache.tokens[ccId].transactions[receiver[0]].indexOf(txid) > -1 && self.cache.tokens[ccId].transactions[receiver[0]][txid].height === -1)) {
                            self.cache.tokens[ccId].transactions[receiver[0]].push({
                              to: receiver[0],
                              from: sender,
                              value: value[0],
                              //confirmations: rawtx.result.confirmations,
                              //rawconfirmations: rawtx.result.rawconfirmations,
                              height: syncFromMempool ? -1 : transaction.height,
                              blockhash: syncFromMempool ? -1 : transaction.blockHash,
                              txid: txid,
                              time: syncFromMempool ? -1 : transaction.blockTimestamp,
                            });
                          }
                        }
                      } else {
                        console.log('CC token onchain exchange ' + ccId);
                        onchainDexTx.push(ccId);
                        // TODO: collect and process such transactions
                      }
                    } else {
                      if (ccId === txid) {
                        console.log('CC contract ' + ccId + ' funding tx = ' + transaction.outputs[1].satoshis + ' tokens, funding address ' + transaction.outputs[1].address);
                        if (transaction.outputs[1].address) self.cache.tokens[ccId].balances[transaction.outputs[1].address] = Number(transaction.outputs[1].satoshis);
                      }
                    }
                  }
                }
                //console.log(ind);
                
                //self.cache.processedTransactionsIndex.push(txid);

                callback();

                if (ind === block.txids.length - 1) {
                  if (!syncFromMempool) {
                    self.cache.lastBlockChecked++;
                    self.lastBlockChecked++;
                    checkBlock(self.lastBlockChecked);

                    //console.log(JSON.stringify(self.cache.tokens, null, 2));
                  } else {
                    checkBlock(self.lastBlockChecked);
                  }
                }
              }
            });
          });
        }
      });
    } else {
      self.tokensSyncInProgress = false;
    }
  }

  checkBlock(self.lastBlockChecked);
}

TokensController.prototype.syncMempool = function() {
  var self = this;

  return new Promise(function(resolve, reject) {
    self.node.services.bitcoind.getRawMemPool(function(err, mempoolTxIds) {
      self.node.log.info('mempool', mempoolTxIds);
      rawMempool = mempoolTxIds;
      resolve();
    });
  });
};

TokensController.prototype.syncTokenInfo = function() {
  var self = this;

  return new Promise(function(resolve, reject) {
    self.node.services.bitcoind.tokenlist(function(err, tokenList) {
      if (!err) {
        console.log(JSON.stringify(tokenList, null, 2));
        async.eachOfSeries(tokenList, (tokenID, index, callback) => {
          self.node.services.bitcoind.tokeninfo(tokenID, function(err, tokenInfo) {
            if (!err) {
              console.log('token #' + index + ' ID: ' + tokenID);
              console.log(JSON.stringify(tokenInfo, null, 2));
              delete tokenInfo.result;
              if (!self.cache.tokens[tokenID]) self.cache.tokens[tokenID] = {
                tokenInfo: {},
              };
              self.cache.tokens[tokenID].tokenInfo = tokenInfo;
              self.cache.tokens[tokenID].tokenInfo.ownerAddress = new bitcore.PublicKey(tokenInfo.owner, {network: bitcore.Networks.livenet}).toAddress().toString();

              self.node.services.bitcoind.getDetailedTransaction(tokenID, function(err, transaction) {
                if (!err) {
                  self.cache.tokens[tokenID].tokenInfo.blocktime = transaction.blockTimestamp;
                  self.cache.tokens[tokenID].tokenInfo.height = transaction.height;
                  //self.cache.tokens[tokenID].tokenInfo.confirmations = txInfo.result.confirmations;
                  self.cache.tokens[tokenID].tokenInfo.blockhash = transaction.blockHash;
                  self.cache.tokens[tokenID].tokenInfo.syncedHeight = 0;

                  // nft
                  // check for nft prefixes f5, f6, f7, stip first byte and attempt to decode as json string
                  if (tokenInfo.hasOwnProperty('data')) {
                    console.log(tokenInfo.data)
                    console.log(Buffer.from(tokenInfo.data, 'hex').toString());
                    var opreturn = Buffer.from(tokenInfo.data, 'hex').toString();
                    var isNftJsonPayloadByteOffset = false;

                    if (tokenInfo.data[0] === 'f' && (tokenInfo.data[1] === '5' || tokenInfo.data[1] === '6' || tokenInfo.data[1] === '7') && tokenInfo.data[2] === '7' && tokenInfo.data[3] === 'b') {
                      isNftJsonPayloadByteOffset = true;
                    }

                    self.cache.tokens[tokenID].tokenInfo.data = {
                      raw: tokenInfo.data,
                    };

                    try {
                      if (isNftJsonPayloadByteOffset) {
                        opreturn = opreturn.substr(1, opreturn.length - 1);
                      }
                      opreturn = JSON.parse(opreturn);
                    } catch (e) {
                      console.log('unable to parse opreturn data as JSON for token ' + tokenID);
                    }
                    self.cache.tokens[tokenID].tokenInfo.data.decoded = opreturn;
                  }

                  if (index === tokenList.length - 1) {
                    console.log('finsihed syncing token info');
                    resolve();
                  }
                }

                callback();
              });
            } else {
              callback();
            }
          });
        });
      }
    });
  });
};

TokensController.prototype.syncTokenOrderbook = function() {
  var self = this;

  return new Promise(function(resolve, reject) {
    self.node.services.bitcoind.tokenorders(function(err, tokenOrders) {
      if (!err) {
        console.log(JSON.stringify(tokenOrders, null, 2));
        self.cache.tokenOrderbook = tokenOrders;
      }
    });
  });
};

TokensController.prototype.sortAddresses = function() {
  var self = this;
  var addresses = Object.keys(this.cache.addresses);
  var flatAddresses = [], flatAddressesReversed = [];

  for (var i = 0; i < addresses.length; i++) {
    flatAddresses.push({
      address: addresses[i],
      balance: helpers.fromSats(this.cache.addresses[addresses[i]])
    });
  }

  flatAddresses.sort(function(a, b){
    if (a.balance > b.balance) {
      return -1;
    }

    if (a.balance < b.balance) {
      return 1;
    }

    return 0;
  });

  this.computed.addresses = flatAddresses;
};

TokensController.prototype.showAll = function(req, res) {
  var result = this.cache.tokens;

  res.jsonp({
    tokens: result,
  });
};

TokensController.prototype.tokenOrderbook = function(req, res) {
  var result = this.cache.tokenOrderbook;
  var ccTokenId = req.query.cctxid;

  if (!ccTokenId) {
    res.jsonp({
      orderbook: result,
    });
  } else {
    var orderbook = [];

    for (var i = 0; i < this.cache.tokenOrderbook.length; i++) {
      if (this.cache.tokenOrderbook[i].tokenid === ccTokenId) {
        orderbook.push(this.cache.tokenOrderbook[i]);
      }
    }

    res.jsonp({
      orderbook: orderbook,
    });
  }
};

TokensController.prototype.dexTrades = function(req, res) {
  var self = this;
  var result = this.cache.tokenOrderbook;
  var ccTokenId = req.query.cctxid;

  if (!ccTokenId) {
    res.jsonp({
      msg: 'error',
      result: 'Missing token ID param',
    });
  } else {
    let trades = [];
    
    if (self.cache.tokens[ccTokenId]) {
      for (let txid in self.cache.tokens[ccTokenId].dexTrades) {
        if (self.cache.tokens[ccTokenId].dexTrades[txid].type === 'fill') trades.push(self.cache.tokens[ccTokenId].dexTrades[txid]);
      }

      res.jsonp({
        trades: trades,
        stats: self.cache.tokens[ccTokenId].dexTradesStats,
      });
    } else {
      res.jsonp({
        error: 'No such token exists',
      });
    }
  }
};

TokensController.prototype.richlist = function(req, res) {
  var self = this;
  var ccTokenId = req.query.cctxid;

  if (!ccTokenId) {
    res.jsonp({
      msg: 'error',
      result: 'Missing token ID param',
    });
  } else {
    let addresses = [];
    
    for (let token in self.cache.tokens) {
      if (token === ccTokenId) {
        for (let address in self.cache.tokens[token].balances) {
          addresses.push({
            address: address,
            balance: self.cache.tokens[token].balances[address]
          });
        }
      }
    }

    addresses.sort(function(a, b){
      if (a.balance > b.balance) {
        return -1;
      }
  
      if (a.balance < b.balance) {
        return 1;
      }
  
      return 0;
    });

    res.jsonp({
      addresses: self.cache.tokens[ccTokenId] && self.cache.tokens[ccTokenId].balances ? addresses : 'No such token exists',
    });
  }
};

TokensController.prototype.transactions = function(req, res) {
  var self = this;
  var ccTokenId = req.query.cctxid;

  if (!ccTokenId) {
    res.jsonp({
      msg: 'error',
      result: 'Missing token ID param',
    });
  } else {
    let transactions = [];
    
    for (let token in self.cache.tokens) {
      if (token === ccTokenId) {
        for (let txid in self.cache.tokens[token].transactionsAll) {
          transactions.push(self.cache.tokens[token].transactionsAll[txid]);
        }
      }
    }

    res.jsonp({
      txs: self.cache.tokens[ccTokenId] && self.cache.tokens[ccTokenId].transactionsAll ? transactions : 'No such token exists',
    });
  }
};

// TODO: No of token holders, volume
TokensController.prototype.tokenlist = function(req, res) {
  var self = this;
  const ccTokenId = req.query.cctxid;

  if (ccTokenId) {
    res.jsonp({
      tokens: self.cache.tokens[ccTokenId] ? self.cache.tokens[ccTokenId].tokenInfo : 'No such token exists',
    });
  } else {
    let tokens = [];

    for (let token in self.cache.tokens) {
      tokens.push(self.cache.tokens[token].tokenInfo);
    }

    res.jsonp({
      tokens: tokens || [],
    });
  }
};

TokensController.prototype.addressBalance = function(req, res) {
  var self = this;

  if (!req.query.address) {
    res.jsonp({
      msg: 'error',
      result: 'Missing address param',
    });
  } else {
    const address = req.query.address;
    const ccTokenId = req.query.cctxid;
    const addressCheck = true/*addressVersionCheck(kmd, address);*/

    if (addressCheck === true) {
      if (!ccTokenId) {
        var balance = [];
        
        for (let token in self.cache.tokens) {
          if (self.cache.tokens[token].balances[address]) {
            balance.push({
              tokenId: token,
              balance: self.cache.tokens[token].balances[address],
            });
          }
        }
      } else {
        if (self.cache.tokens[ccTokenId]) {
          var totalReceived = 0, totalSent = 0;
          
          for (let i = 0; i < self.cache.tokens[ccTokenId].transactions[address].length; i++) {
            if (self.cache.tokens[ccTokenId].transactions[address][i].from === address) {
              totalSent += self.cache.tokens[ccTokenId].transactions[address][i].value;
            } else {
              totalReceived += self.cache.tokens[ccTokenId].transactions[address][i].value;
            }
          }

          res.jsonp({
            balance: self.cache.tokens[ccTokenId].balances[address] ? self.cache.tokens[ccTokenId].balances[address] : 0,
            totalReceived: totalReceived,
            totalSent: totalSent,
            txAppearances: self.cache.tokens[ccTokenId].transactions[address].length || 0,
          });
        } else {
          res.jsonp({
            msg: 'error',
            result: 'No such token ID exists',
          });
        }
      }
    } else {
      res.jsonp({
        msg: 'error',
        result: 'Incorrect smart chain address',
      });
    }
  }
};

TokensController.prototype.addressTransactions = function(req, res) {
  var self = this;

  if (!req.query.address) {
    res.jsonp({
      msg: 'error',
      result: 'Missing address param',
    });
  } else {
    const address = req.query.address;
    const ccTokenId = req.query.cctxid;
    const addressCheck = true/*addressVersionCheck(kmd, address);*/
    const txid = req.query.txid;

    if (addressCheck === true) {
      if (!ccTokenId) {
        var transactions = [];
        
        for (let token in self.cache.tokens) {
          if (self.cache.tokens[token].transactions[address]) {
            transactions.push({
              tokenId: token,
              txs: self.cache.tokens[token].transactions[address],
            });
          }
        }

        res.jsonp({
          txs: transactions,
        });
      } else {
        if (self.cache.tokens[ccTokenId]) {
          if (txid) {
            res.jsonp({
              txs: self.cache.tokens[ccTokenId] && self.cache.tokens[ccTokenId].transactionsAll[txid] ? self.cache.tokens[ccTokenId].transactionsAll[txid] : 'Transaction doesn\'t exist',
            });
          } else {
            res.jsonp({
              txs: self.cache.tokens[ccTokenId].transactions[address] ? self.cache.tokens[ccTokenId].transactions[address] : [],
            });
          }
        } else {
          res.jsonp({
            msg: 'error',
            result: 'No such token ID exists',
          });
        }
      }
    } else {
      res.jsonp({
        msg: 'error',
        result: 'Incorrect smart chain address',
      });
    }
  }
};

TokensController.prototype.dumpData = function() {  
  this.dataDumpInProgress = true;
  fs.writeFileSync(this.commonCache, JSON.stringify(this.cache));
  this.node.log.info('tokens on node stop, dumped data');
};

module.exports = TokensController;
