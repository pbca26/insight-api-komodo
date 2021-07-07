'use strict';

var async = require('async');
var fs = require('fs');
var bitcore = require('bitcore-lib-komodo');

var Common = require('./common');
var helpers = require('./math-helpers');
var tokenDecoder = require('./token-decoder');

var TIP_SYNC_INTERVAL = 10;
var SKIP_OP_CHECKCRYPTOCONDITION = false;
var MEMPOOL_SYNC_INTERVAL = 2; // seconds
var RESTART_PAST_BLOCKS_LOOKUP = 5;
var isRestarted = true;

// TODO:
//   - split balance in conf and unconf
//   - decouple ask/bid/cancel/transfer categorization into a separate method

var onchainDexTx = [];
var rawMempool = [];

var sortTransactions = (transactions, sortBy) => {
  return transactions.sort((b, a) => {
    if (!sortBy || sortBy === 'height') {
      if (a[sortBy ? sortBy : 'height'] < 0 &&
          b[sortBy ? sortBy : 'height']) {
        return 1;
      }

      if (b[sortBy ? sortBy : 'height'] < 0 &&
          a[sortBy ? sortBy : 'height']) {
        return -1;
      }
    }

    if (!a[sortBy ? sortBy : 'height'] &&
        b[sortBy ? sortBy : 'height']) {
      return 1;
    }

    if (!b[sortBy ? sortBy : 'height'] &&
        a[sortBy ? sortBy : 'height']) {
      return -1;
    }

    if (a[sortBy ? sortBy : 'height'] < b[sortBy ? sortBy : 'height'] &&
        a[sortBy ? sortBy : 'height'] &&
        b[sortBy ? sortBy : 'height']) {
      return -1;
    }

    if (a[sortBy ? sortBy : 'height'] > b[sortBy ? sortBy : 'height'] &&
        a[sortBy ? sortBy : 'height'] &&
        b[sortBy ? sortBy : 'height']) {
      return 1;
    }

    return 0;
  });
}

function TokensController(node) {
  this.node = node;
  this.nodeConfig = JSON.parse(fs.readFileSync(this.node.configPath, 'UTF-8'));
  this.commonCache = this.node.configPath.replace('bitcore-node.json', 'tokens-common.json');
  this.addressesIndex = this.node.configPath.replace('bitcore-node.json', 'tokens-addresses.json');
  this.processedTransactionsIndex = this.node.configPath.replace('bitcore-node.json', 'tokens-processed-transactions.json');
  this.common = new Common({log: this.node.log});
  this.cache = {
    lastBlockChecked: 1,
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
              self.syncTokenOrderbook();
              self.syncBlocks(true);
            } else {
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
            self.syncTokenOrderbook();
            self.syncBlocks();
          });
        }
      }
    });
  }, TIP_SYNC_INTERVAL * 1000);

  setInterval(() => {
    self.syncMempool().then(function() {
      if (rawMempool.length) {
        self.node.log.info('sync raw mempool', rawMempool);
        self.syncBlocks(true);
      }
    });
  }, 200);

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
    if (syncFromMempool || height <= self.currentBlock) {
      self.tokensSyncInProgress = true;
      self.lastBlockProcessedTime = Date.now();

      self.node.log.info('tokens sync at ht. ' + self.lastBlockChecked);

      self.node.services.bitcoind.getBlockOverview(syncFromMempool ? self.lastBlockChecked - 1 : height, function(err, block) {
        //self.node.log.info(err)
        if (!err) {
          //self.node.log.info('block', block);
          var txids = syncFromMempool ? rawMempool : block.txids;
          //self.node.log.info('txids', txids);
          
          async.eachOfSeries(txids, (txid, ind, callback) => {
            self.node.services.bitcoind.getDetailedTransaction(txid, function(err, transaction) {
              //self.node.log.info(transaction);
              
              if (!err) {
                var isCCTX = false;
                var isContractCreateMempool = false;
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
                  self.node.log.info('CC TX');
                  
                  var isContractCreateMempool = false, tx;
                  var decodedOpreturn = tokenDecoder.decodeOpreturn(transaction);
                  
                  // parse tokencreate tx if in mempool
                  var contractDetails = tokenDecoder.decodeTokenCreateDetails(transaction);

                  if (decodedOpreturn && decodedOpreturn.hasOwnProperty('create')) {
                    self.node.log.info('name', contractDetails.name);
                    self.node.log.info('desc', contractDetails.description);
                    self.node.log.info('supply', contractDetails.supply);
                    self.node.log.info('owner ' + contractDetails.owner + ' | ' + contractDetails.ownerAddress);
                    self.node.log.info('nft data', contractDetails.nftData);
                    isContractCreateMempool = true;

                    var tokenInfo = {
                      time: syncFromMempool ? Date.now() / 1000 : transaction.blockTimestamp,
                      blocktime: syncFromMempool ? Date.now() / 1000 : transaction.blockTimestamp,
                      description: contractDetails.description,
                      height: syncFromMempool ? -1 : transaction.height,
                      blockhash: syncFromMempool ? -1 : transaction.blockHash,
                      name: contractDetails.name,
                      owner: contractDetails.owner,
                      ownerAddress: contractDetails.ownerAddress,
                      supply: contractDetails.supply,
                      syncedHeight: 0,
                      tokenid: txid,
                      data: contractDetails.nftData ? {decoded: contractDetails.nftData} : contractDetails.nftData,
                    };
                    self.cache.tokens[txid] = {
                      tokenInfo: tokenInfo,
                    };
                  }

                  var ccId = decodedOpreturn && decodedOpreturn.tokenid;

                  if (ccId) {
                    if (!self.cache.tokens[ccId].addresses) self.cache.tokens[ccId]['addresses'] = {};
                    if (!self.cache.tokens[ccId].balances) self.cache.tokens[ccId]['balances'] = {};
                    if (!self.cache.tokens[ccId].transactions) self.cache.tokens[ccId]['transactions'] = {};
                    if (!self.cache.tokens[ccId].transactionsIndex) self.cache.tokens[ccId]['transactionsIndex'] = {};
                    if (!self.cache.tokens[ccId].transactionsAll) self.cache.tokens[ccId]['transactionsAll'] = {};
                    if (!self.cache.tokens[ccId].dexTrades) self.cache.tokens[ccId]['dexTrades'] = {};
                    if (!self.cache.tokens[ccId].dexTradesStats) self.cache.tokens[ccId]['dexTradesStats'] = {
                      count: 0,
                      volume: 0,
                    };
                  }

                  if (self.cache.tokens[ccId] &&
                      self.cache.tokens[ccId].tokenInfo &&
                      self.cache.tokens[ccId].tokenInfo.data &&
                      self.cache.tokens[ccId].tokenInfo.data.decoded &&
                      self.cache.tokens[ccId].tokenInfo.data.decoded.royalty &&
                      Number(self.cache.tokens[ccId].tokenInfo.data.decoded.royalty) > 0) {
                    self.node.log.info('royalty', self.cache.tokens[ccId].tokenInfo.data.decoded.royalty);
                    decodedOpreturn = tokenDecoder.decodeOpreturn(transaction, {royalty: self.cache.tokens[ccId].tokenInfo.data.decoded.royalty});
                  }

                  if (decodedOpreturn && decodedOpreturn.hasOwnProperty('transfer')) {
                    if (!isContractCreateMempool &&
                        transaction.inputs[1] &&
                        transaction.inputs[1].hasOwnProperty('address')) {
                      /*if (transaction.inputs.length === 3 && transaction.outputs[0].satoshis === 0 && transaction.outputs.length >= 4) {
                        self.node.log.info('CC DEX buy from ' + transaction.inputs[2].address + ' at price ' + helpers.fromSats(transaction.inputs[1].satoshis) + ', tokens received ' + transaction.outputs[2].satoshis + ' to address ' + transaction.outputs[2].address);*/
                      if (decodedOpreturn.type === 'fill' || decodedOpreturn.type === 'fillbid') {
                        self.node.log.info('CC DEX buy from ' + decodedOpreturn.transfer.from + ' at price ' + decodedOpreturn.order.price.value + ', tokens received ' + decodedOpreturn.order.amount.value + ' to address ' + decodedOpreturn.transfer.to);
    
                        if (Object.keys(self.cache.tokens[ccId].dexTrades).indexOf(txid) === -1) {
                          tx = {
                            from: decodedOpreturn.transfer.from,
                            to: decodedOpreturn.transfer.to,
                            value: decodedOpreturn.transfer.value,
                            //confirmations: rawtx.result.confirmations,
                            //rawconfirmations: rawtx.result.rawconfirmations,
                            height: syncFromMempool ? -1 : transaction.height,
                            blockhash: syncFromMempool ? -1 : transaction.blockHash,
                            txid: txid,
                            time: syncFromMempool ? Date.now() / 1000 : transaction.blockTimestamp,
                            price: decodedOpreturn.order.price.value,
                            type: 'fill',
                            tokenid: ccId,
                          };

                          if (decodedOpreturn.order && decodedOpreturn.order.royalty) tx.royalty = decodedOpreturn.order.royalty;
  
                          self.cache.tokens[ccId].dexTrades[txid] = tx;
                          self.cache.tokens[ccId].dexTradesStats.count++;
                          self.cache.tokens[ccId].dexTradesStats.volume += decodedOpreturn.transfer.value;
                        }
                      } else if (decodedOpreturn.type === 'cancel' || decodedOpreturn.type === 'cancelask') {
                        self.node.log.info('CC DEX cancel order from ' + decodedOpreturn.transfer.from + ', ' + decodedOpreturn.transfer.value + ' tokens received back to address ' + decodedOpreturn.transfer.to);

                        if (Object.keys(self.cache.tokens[ccId].dexTrades).indexOf(txid) === -1) {
                          tx = {
                            from: decodedOpreturn.transfer.from,
                            to: decodedOpreturn.transfer.to,
                            value: decodedOpreturn.transfer.value,
                            //confirmations: rawtx.result.confirmations,
                            //rawconfirmations: rawtx.result.rawconfirmations,
                            height: syncFromMempool ? -1 : transaction.height,
                            blockhash: syncFromMempool ? -1 : transaction.blockHash,
                            txid: txid,
                            time: syncFromMempool ? Date.now() / 1000 : transaction.blockTimestamp,
                            type: 'cancel',
                            tokenid: ccId,
                          };

                          self.cache.tokens[ccId].dexTrades[txid] = tx;
                        }
                      } else {
                        self.node.log.info('CC token transfer from ' + decodedOpreturn.transfer.from + ', to ' + decodedOpreturn.transfer.to + ', value ' + decodedOpreturn.transfer.value);
                        tx = {
                          from: decodedOpreturn.transfer.from,
                          to: decodedOpreturn.transfer.to,
                          value: decodedOpreturn.transfer.value,
                          //confirmations: rawtx.result.confirmations,
                          //rawconfirmations: rawtx.result.rawconfirmations,
                          height: syncFromMempool ? -1 : transaction.height,
                          blockhash: syncFromMempool ? -1 : transaction.blockHash,
                          txid: txid,
                          time: syncFromMempool ? Date.now() / 1000 : transaction.blockTimestamp,
                          type: decodedOpreturn.type !== 'transfer' ? decodedOpreturn.type : 'transfer',
                          tokenid: ccId,
                        };

                        if (decodedOpreturn.type === 'fillask') {
                          if (decodedOpreturn.order && decodedOpreturn.order.royalty) tx.royalty = decodedOpreturn.order.royalty;
                          tx.price = decodedOpreturn.order.price.value;
                          self.cache.tokens[ccId].dexTrades[txid] = tx;
                          self.cache.tokens[ccId].dexTradesStats.count++;
                          self.cache.tokens[ccId].dexTradesStats.volume += decodedOpreturn.transfer.value;
                        }
                      }
  
                      if (Object.keys(self.cache.tokens[ccId].addresses).indexOf(tx.from) === -1) self.cache.tokens[ccId].addresses[tx.from] = [];
                      if (Object.keys(self.cache.tokens[ccId].addresses).indexOf(tx.to) === -1) self.cache.tokens[ccId].addresses[tx.to] = [];
                      if (Object.keys(self.cache.tokens[ccId].balances).indexOf(tx.from) === -1) self.cache.tokens[ccId].balances[tx.from] = 0;
                      if (Object.keys(self.cache.tokens[ccId].balances).indexOf(tx.to) === -1) self.cache.tokens[ccId].balances[tx.to] = 0;
                      
                      if (tx.from !== tx.to && Object.keys(self.cache.tokens[ccId].transactionsAll).indexOf(txid) === -1) {
                        self.cache.tokens[ccId].balances[tx.from] -= Number(tx.value);
                        self.cache.tokens[ccId].balances[tx.to] += Number(tx.value);
                      }
  
                      if (Object.keys(self.cache.tokens[ccId].transactionsAll).indexOf(txid) === -1 || (Object.keys(self.cache.tokens[ccId].transactionsAll).indexOf(txid) > -1 && self.cache.tokens[ccId].transactionsAll[txid].height === -1)) {
                        self.cache.tokens[ccId].transactionsAll[txid] = tx;
                      }
  
                      if (!self.cache.tokens[ccId].transactions[tx.from]) self.cache.tokens[ccId].transactions[tx.from] = [];
                      if (!self.cache.tokens[ccId].transactionsIndex[tx.from]) self.cache.tokens[ccId].transactionsIndex[tx.from] = [];
                      if (self.cache.tokens[ccId].addresses[tx.from].indexOf(txid) === -1) {
                        self.cache.tokens[ccId].addresses[tx.from].push(txid);
                      }
  
                      if (self.cache.tokens[ccId].transactionsIndex[tx.from].indexOf(txid) === -1) {
                        self.cache.tokens[ccId].transactionsIndex[tx.from].push(txid);
                        self.cache.tokens[ccId].transactions[tx.from].push(tx);
                      } else if (self.cache.tokens[ccId].transactionsIndex[tx.from].indexOf(txid) > -1 && self.cache.tokens[ccId].transactions[tx.from][self.cache.tokens[ccId].transactionsIndex[tx.from].indexOf(txid)].height === -1) {
                        self.cache.tokens[ccId].transactions[tx.from][self.cache.tokens[ccId].transactionsIndex[tx.from].indexOf(txid)] = tx;
                        self.node.log.info('update mempool tx', self.cache.tokens[ccId].transactions[tx.from][self.cache.tokens[ccId].transactionsIndex[tx.from].indexOf(txid)]);
                      }
  
                      if (!self.cache.tokens[ccId].transactions[tx.to]) self.cache.tokens[ccId].transactions[tx.to] = [];
                      if (!self.cache.tokens[ccId].transactionsIndex[tx.to]) self.cache.tokens[ccId].transactionsIndex[tx.to] = [];
                      if (tx.from !== tx.to && self.cache.tokens[ccId].addresses[tx.to].indexOf(txid) === -1) {
                        self.cache.tokens[ccId].addresses[tx.to].push(txid);
                      }
  
                      if (tx.from !== tx.to) {
                        if (self.cache.tokens[ccId].transactionsIndex[tx.to].indexOf(txid) === -1) {
                          self.cache.tokens[ccId].transactionsIndex[tx.to].push(txid);
                          self.cache.tokens[ccId].transactions[tx.to].push(tx);
                        } else if (self.cache.tokens[ccId].transactionsIndex[tx.to].indexOf(txid) > -1 && self.cache.tokens[ccId].transactions[tx.to][self.cache.tokens[ccId].transactionsIndex[tx.to].indexOf(txid)].height === -1) {
                          self.cache.tokens[ccId].transactions[tx.to][self.cache.tokens[ccId].transactionsIndex[tx.to].indexOf(txid)] = tx;
                          self.node.log.info('update mempool tx', self.cache.tokens[ccId].transactions[tx.to][self.cache.tokens[ccId].transactionsIndex[tx.to].indexOf(txid)]);
                        }
                      }
                    } else {
                      self.node.log.info('CC token onchain exchange ' + ccId);
                      onchainDexTx.push(ccId);
                      // TODO: collect and process such transactions
                    }
                  } else if (decodedOpreturn && decodedOpreturn.hasOwnProperty('create')) {
                    self.node.log.info('CC contract ' + ccId + ' funding tx = ' + decodedOpreturn.create.supply + ' tokens, funding address ' + decodedOpreturn.create.ownerAddress);
                    self.cache.tokens[ccId].balances[decodedOpreturn.create.ownerAddress] = Number(decodedOpreturn.create.supply);
                    tx = {
                      tokenid: ccId,
                      to: decodedOpreturn.create.ownerAddress,
                      value: Number(decodedOpreturn.create.supply),
                      //confirmations: rawtx.result.confirmations,
                      //rawconfirmations: rawtx.result.rawconfirmations,
                      height: syncFromMempool ? -1 : transaction.height,
                      blockhash: syncFromMempool ? -1 : transaction.blockHash,
                      txid: txid,
                      time: syncFromMempool ? Date.now() / 1000 : transaction.blockTimestamp,
                      type: 'coinbase',
                    };

                    if (Object.keys(self.cache.tokens[ccId].addresses).indexOf(tx.to) === -1) self.cache.tokens[ccId].addresses[tx.to] = [];
                    if (!self.cache.tokens[ccId].transactions[tx.to]) self.cache.tokens[ccId].transactions[tx.to] = [];
                    if (!self.cache.tokens[ccId].transactionsIndex[tx.to]) self.cache.tokens[ccId].transactionsIndex[tx.to] = [];

                    self.cache.tokens[ccId].transactionsIndex[tx.to].push(txid);
                    self.cache.tokens[ccId].transactions[tx.to].push(tx);
                    self.cache.tokens[ccId].addresses[tx.to].push(txid);
                    self.cache.tokens[ccId].transactionsAll[txid] = tx;
                  }
                }
                //self.node.log.info(ind);
                
                //self.cache.processedTransactionsIndex.push(txid);

                callback();

                if (ind === block.txids.length - 1) {
                  if (!syncFromMempool) {
                    self.cache.lastBlockChecked++;
                    self.lastBlockChecked++;
                    checkBlock(self.lastBlockChecked);

                    //self.node.log.info(JSON.stringify(self.cache.tokens, null, 2));
                  } else {
                    self.tokensSyncInProgress = false;
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
    self.node.services.bitcoind.tokenlist(self.nodeConfig.tokens && self.nodeConfig.tokens.version || 'v1', function(err, tokenList) {
      if (!err) {
        self.node.log.info(JSON.stringify(tokenList, null, 2));
        async.eachOfSeries(tokenList, (tokenID, index, callback) => {
          self.node.services.bitcoind.tokeninfo(self.nodeConfig.tokens && self.nodeConfig.tokens.version || 'v1', tokenID, function(err, tokenInfo) {
            if (!err) {
              self.node.log.info('token #' + index + ' ID: ' + tokenID);
              self.node.log.info(JSON.stringify(tokenInfo, null, 2));
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

                  // nft
                  // check for nft prefixes f5, f6, f7, stip first byte and attempt to decode as json string
                  if (tokenInfo.hasOwnProperty('data')) {
                    var datablob = tokenInfo.data;
                    self.node.log.info(tokenInfo.data)
                    self.node.log.info(Buffer.from(tokenInfo.data, 'hex').toString());
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
                      self.node.log.info('unable to parse opreturn data as JSON for token ' + tokenID);
                    }

                    if (datablob.indexOf('f701') > -1) {
                      var v2NftData = tokenDecoder.readV2NftData(datablob);

                      if (v2NftData) opreturn = v2NftData;
                    }

                    self.cache.tokens[tokenID].tokenInfo.data.decoded = opreturn;
                  }

                  if (index === tokenList.length - 1) {
                    self.node.log.info('finsihed syncing token info');
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
    self.node.services.bitcoind.tokenorders(self.nodeConfig.tokens && self.nodeConfig.tokens.version || 'v1', function(err, tokenOrders) {
      if (!err) {
        self.node.log.info(JSON.stringify(tokenOrders, null, 2));
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
    var trades = [];
    
    if (self.cache.tokens[ccTokenId]) {
      for (var txid in self.cache.tokens[ccTokenId].dexTrades) {
        if (self.cache.tokens[ccTokenId].dexTrades[txid].type.indexOf('fill') > -1 || self.cache.tokens[ccTokenId].dexTrades[txid].type.indexOf('ask') > -1) trades.push(self.cache.tokens[ccTokenId].dexTrades[txid]);
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
    var addresses = [];
    
    for (var token in self.cache.tokens) {
      if (token === ccTokenId) {
        for (var address in self.cache.tokens[token].balances) {
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
    var txid = req.query.txid;
    var transactions = [];

    if (txid) {
      res.jsonp({
        txs: self.cache.tokens[ccTokenId] && self.cache.tokens[ccTokenId].transactionsAll[txid] ? self.cache.tokens[ccTokenId].transactionsAll[txid] : 'No such transaction exists',
      });
    } else {
      for (var token in self.cache.tokens) {
        if (token === ccTokenId) {
          for (var _txid in self.cache.tokens[token].transactionsAll) {
            transactions.push(self.cache.tokens[token].transactionsAll[_txid]);
          }
        }
      }

      sortTransactions(transactions);

      res.jsonp({
        txs: self.cache.tokens[ccTokenId] && self.cache.tokens[ccTokenId].transactionsAll ? transactions : 'No such token exists',
      });
    }
  }
};

// TODO: No of token holders, volume
TokensController.prototype.tokenlist = function(req, res) {
  var self = this;
  var ccTokenId = req.query.cctxid;

  if (ccTokenId) {
    res.jsonp({
      tokens: self.cache.tokens[ccTokenId] ? self.cache.tokens[ccTokenId].tokenInfo : 'No such token exists',
    });
  } else {
    var tokens = [];

    for (var token in self.cache.tokens) {
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
    var address = req.query.address;
    var ccTokenId = req.query.cctxid;
    var addressCheck = true/*addressVersionCheck(kmd, address);*/

    if (addressCheck === true) {
      if (!ccTokenId) {
        var balance = [];
        
        for (var token in self.cache.tokens) {
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
          var totalReceived = 0, totalSent = 0;
          
          if (self.cache.tokens[ccTokenId].transactions[address]) {
            for (var i = 0; i < self.cache.tokens[ccTokenId].transactions[address].length; i++) {
              if (self.cache.tokens[ccTokenId].transactions[address][i].to === address && self.cache.tokens[ccTokenId].transactions[address][i].from === address) {
                totalReceived += self.cache.tokens[ccTokenId].transactions[address][i].value;
                totalSent += self.cache.tokens[ccTokenId].transactions[address][i].value;
              } else {
                if (self.cache.tokens[ccTokenId].transactions[address][i].from === address) {
                  totalSent += self.cache.tokens[ccTokenId].transactions[address][i].value;
                } else {
                  totalReceived += self.cache.tokens[ccTokenId].transactions[address][i].value;
                }
              }
            }
          }

          res.jsonp({
            balance: self.cache.tokens[ccTokenId].balances[address] ? self.cache.tokens[ccTokenId].balances[address] : 0,
            totalReceived: totalReceived,
            totalSent: totalSent,
            txAppearances: self.cache.tokens[ccTokenId].transactions[address] ? self.cache.tokens[ccTokenId].transactions[address].length : 0,
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
    var address = req.query.address;
    var ccTokenId = req.query.cctxid;
    var addressCheck = true/*addressVersionCheck(kmd, address);*/
    var txid = req.query.txid;

    if (addressCheck === true) {
      if (!ccTokenId) {
        var transactions = [];
        
        for (var token in self.cache.tokens) {
          if (self.cache.tokens[token].transactions[address]) {
            var transactionsToSort = self.cache.tokens[token].transactions[address];

            sortTransactions(transactionsToSort);

            transactions.push({
              tokenId: token,
              txs: transactionsToSort,
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
            var transactions = self.cache.tokens[ccTokenId].transactions[address] ? self.cache.tokens[ccTokenId].transactions[address] : [];
            sortTransactions(transactions);

            res.jsonp({
              txs: transactions,
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

TokensController.prototype.decode = async function(req, res) {
  var self = this;
  var rawtx = req.body.rawtx;

  if (!rawtx) {
    res.jsonp({
      msg: 'error',
      result: 'Missing rawtx data',
    });
  } else {
    try {
      self.node.services.bitcoind.decodeRawTransaction(rawtx, async function(err, transaction) {
        if (err) {
          res.jsonp({
            msg: 'error',
            result: 'Unable to decode rawtx data',
          });
        } else {
          var formattedTransaction = JSON.parse(JSON.stringify(transaction));

          formattedTransaction.inputs = formattedTransaction.vin;
          formattedTransaction.outputs = formattedTransaction.vout;
          delete formattedTransaction.vin;
          delete formattedTransaction.vout;
        
          for (var j = 0; j < formattedTransaction.inputs.length; j++) {
            formattedTransaction.inputs[j].satoshis = formattedTransaction.inputs[j].valueZat;
          }
        
          for (var j = 0; j < formattedTransaction.outputs.length; j++) {
            formattedTransaction.outputs[j].scriptAsm = formattedTransaction.outputs[j].scriptPubKey.asm;
            formattedTransaction.outputs[j].script = formattedTransaction.outputs[j].scriptPubKey.hex;
            formattedTransaction.outputs[j].satoshis = formattedTransaction.outputs[j].valueZat;
            if (formattedTransaction.outputs[j].scriptPubKey.addresses) formattedTransaction.outputs[j].address = formattedTransaction.outputs[j].scriptPubKey.addresses[0];
          }

          var decodedOpreturn = tokenDecoder.decodeOpreturn(formattedTransaction);
          
          res.jsonp({
            decoded: decodedOpreturn,
          });
        }
      });
    } catch (e) {
      res.jsonp({
        msg: 'error',
        result: 'Unable to decode rawtx data',
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
