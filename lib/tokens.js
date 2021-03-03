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
    tokenOrders: {},
    tokenOrdersFlat: [],
  };
  this.computed = {
    addresses: [],
  };
  this.currentBlock = 0;
  this.lastBlockChecked = 0;
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
    //this.lastBlockChecked = this.cache.lastBlockChecked + 1;
  } catch (e) {
    self.node.log.info(e);
  }

  /*self.syncTokenInfo()
  .then(function(res) {
    console.log(JSON.stringify(self.cache.tokens, null, 2));
    
    console.log('sync blocks');
    self.syncBlocks();
  });
  //self.syncBlocks();

  /*this.node.services.bitcoind.getInfo(function(err, result) {
    if (!err) {
      self.node.log.info('sync getInfo', result);
      self.currentBlock = result.blocks;
      self.node.log.info('tokens sync: ' + self.tokensSyncInProgress);
      if (!self.tokensSyncInProgress) self.syncBlocks();
    }
  });

  setInterval(() => {
    this.node.services.bitcoind.getInfo(function(err, result) {
      if (!err) {
        self.node.log.info('sync getInfo', result);
        self.currentBlock = result.blocks;
        self.kickStartSync();
        self.node.log.info('richlist sync: ' + self.tokensSyncInProgress);
        if (!self.tokensSyncInProgress) self.syncBlocks();
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
  }, 5 * 1000);*/
};

TokensController.prototype.syncBlocks = function() {
  var self = this;
  self.node.log.info('tokens sync start at ht. ' + self.lastBlockChecked);

  var checkBlock = function(height) {
    if (height <= self.currentBlock) {
      self.tokensSyncInProgress = true;
      self.lastBlockProcessedTime = Date.now();

      self.node.log.info('tokens sync at ht. ' + self.lastBlockChecked);

      self.node.services.bitcoind.getBlockOverview(height, function(err, block) {
        if (!err) {
          self.node.log.info('block', block);

          async.eachOfSeries(block.txids, (txid, ind, callback) => {
            var txids = block.txids;

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
                  for (let cc = 0; cc < Object.keys(self.cache.tokens).length; cc++) {
                    const ccId = Object.keys(self.cache.tokens)[cc];
                    let isCCTransfer = false, isCCOnChainDexOrder = false;
                    let value = [], receiver = [], sender, fundingTx; // TODO: append funging tx to tx history
    
                    //if (!self.cache.tokens) self.cache.tokens[chain] = {};
                    //if (!self.cache.tokens[ccId]) self.cache.tokens[ccId] = {};
                    if (!self.cache.tokens[ccId].addresses) self.cache.tokens[ccId]['addresses'] = {};
                    if (!self.cache.tokens[ccId].balances) self.cache.tokens[ccId]['balances'] = {};
                    if (!self.cache.tokens[ccId].transactions) self.cache.tokens[ccId]['transactions'] = {};
                    if (!self.cache.tokens[ccId].transactionsAll) self.cache.tokens[ccId]['transactionsAll'] = {};
                    if (!self.cache.tokens[ccId].dexTrades) self.cache.tokens[ccId]['dexTrades'] = {};
                    
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
                        console.log('CC token transfer destpubaddress=' + new bitcore.PublicKey(transaction.outputs[a].script.substr(transaction.outputs[a].script.length - 66, 66), {network: bitcore.Networks.kmdnet}).toAddress().toString());
                      }
                    }
    
                    if (transaction.inputs.length === 2 || (transaction.inputs.length === 3 && transaction.outputs[0].satoshis === 0 && transaction.outputs.length >= 4)) {
                      isCCOnChainDexOrder = false;
                    } else {
                      isCCOnChainDexOrder = true;
                    }
    
                    if (isCCTransfer) {
                      if (!isCCOnChainDexOrder &&
                          transaction.inputs[1] &&
                          transaction.inputs[1].hasOwnProperty('address') &&
                          (process.argv.indexOf('reindex') > -1 || (process.argv.indexOf('reindex') === -1 && self.cache.tokenOrdersFlat && self.cache.tokenOrdersFlat.indexOf(txid) === -1))) {
                        if (transaction.inputs.length === 3 && transaction.outputs[0].satoshis === 0 && transaction.outputs.length >= 4) {
                          console.log('CC DEX buy from ' + transaction.inputs[2].address + ' at price ' + helpers.fromSats(transaction.inputs[1].satoshis) + ', tokens received ' + transaction.outputs[2].satoshis + ' to address ' + transaction.outputs[2].address);
                          sender = transaction.inputs[2].address;
                          receiver[0] = transaction.outputs[2].address;
                          value[0] = transaction.outputs[2].satoshis;
    
                          if (Object.keys(self.cache.tokens[ccId].dexTrades).indexOf(txid) === -1) {
                            self.cache.tokens[ccId].dexTrades[txid] = {
                              from: sender,
                              to: receiver[0],
                              value: value[0],
                              //confirmations: rawtx.result.confirmations,
                              //rawconfirmations: rawtx.result.rawconfirmations,
                              height: transaction.height,
                              blockhash: transaction.blockHash,
                              txid: txids,
                              time: transaction.blockTimestamp,
                              price: helpers.fromSats(transaction.inputs[1].satoshis),
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
    
                        self.cache.tokens[ccId].transactionsAll[txid] = {
                          from: sender,
                          to: receiver[0],
                          value: value[0],
                          //confirmations: rawtx.result.confirmations,
                          //rawconfirmations: rawtx.result.rawconfirmations,
                          height: transaction.height,
                          blockhash: transaction.blockHash,
                          txid: txid,
                          time: transaction.blockTimestamp,
                        };
    
                        if (!self.cache.tokens[ccId].transactions[sender]) self.cache.tokens[ccId].transactions[sender] = [];
                        if (self.cache.tokens[ccId].addresses[sender].indexOf(txids) === -1) {
                          self.cache.tokens[ccId].addresses[sender].push(txids);
                        }
    
                        self.cache.tokens[ccId].transactions[sender].push({
                          from: sender,
                          to: receiver[0],
                          value: value[0],
                          //confirmations: rawtx.result.confirmations,
                          //rawconfirmations: rawtx.result.rawconfirmations,
                          height: transaction.height,
                          blockhash: transaction.blockHash,
                          txid: txid,
                          time: transaction.blockTimestamp,
                        });
    
                        if (!self.cache.tokens[ccId].transactions[receiver[0]]) self.cache.tokens[ccId].transactions[receiver[0]] = [];
                        if (sender !== receiver[0] && self.cache.tokens[ccId].addresses[receiver[0]].indexOf(txid) === -1) {
                          self.cache.tokens[ccId].addresses[receiver[0]].push(txid);
                        }
    
                        if (sender !== receiver[0]) {
                          self.cache.tokens[ccId].transactions[receiver[0]].push({
                            to: receiver[0],
                            from: sender,
                            value: value[0],
                            //confirmations: rawtx.result.confirmations,
                            //rawconfirmations: rawtx.result.rawconfirmations,
                            height: transaction.height,
                            blockhash: transaction.blockHash,
                            txid: txid,
                            time: transaction.blockTimestamp,
                          });
                        }
                      } else {
                        console.log('CC token onchain exchange');
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
                  self.cache.lastBlockChecked++;
                  self.lastBlockChecked++;
                  checkBlock(self.lastBlockChecked);

                  //console.log(JSON.stringify(self.cache.tokens, null, 2));
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

TokensController.prototype.syncTokenInfo = function(chain) {
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
              self.cache.tokens[tokenID].tokenInfo.ownerAddress = new bitcore.PublicKey(tokenInfo.owner, {network: bitcore.Networks.kmdnet}).toAddress().toString();

              self.node.services.bitcoind.getDetailedTransaction(tokenID, function(err, transaction) {
                if (!err) {
                  self.cache.tokens[tokenID].tokenInfo.blocktime = transaction.blockTimestamp;
                  self.cache.tokens[tokenID].tokenInfo.height = transaction.height;
                  //self.cache.tokens[tokenID].tokenInfo.confirmations = txInfo.result.confirmations;
                  self.cache.tokens[tokenID].tokenInfo.blockhash = transaction.blockHash;
                  self.cache.tokens[tokenID].tokenInfo.syncedHeight = 0;

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

        res.jsonp({
          balance: balance,
        });
      } else {
        if (self.cache.tokens[ccTokenId]) {
          res.jsonp({
            balance: self.cache.tokens[ccTokenId].balances[address] ? self.cache.tokens[ccTokenId].balances[address] : 0,
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
