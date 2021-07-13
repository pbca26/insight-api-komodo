/*
  Tokens CC OP_RETURN encoding format

  Variable int format is described here https://en.bitcoin.it/wiki/Protocol_documentation#Variable_length_integer

  General opreturn encoding format (serialized):
    evalcode  1b
    funcid    1b
    version   1b
    tokenid   32b
    numpk     1b
    pk-len    1b
    pk1       33b
    pk-len    1b (optional)
    pk2       33b (optional)
    assets-data-len (var int length)
    asset-data

  Format for assets-data type 's', 'S', 'b', 'B':
    evalcode        1b
    funcid          1b
    version         1b
    null-asset-id   32b
    unit-price      8b (in bitcoin transaction output format, UInt32LE)
    pk-len          1b
    originator-pk   33b

  Format for assets-data type 'o', 'x'
    evalcode        1b
    funcid          1b
    version         1b
    unit-price      8b
    pk-len          1b
    originator-pk   33b

  Fillask vout format:
    vout 0 - send tokens for ask order to global address
    vout 1 - send coins to buyer 
    vout 2 - send coins to seller

  Fillbid vout format:
    vout 0 - send tokens for bid order to global address
    vout 1 - send coins to buyer
    vout 2 - send coins to seller

  Token create format
    evalcode:   1b
    funcid:     1b
    version:    1b
    creator-pubkey: length (variable int) + data
    name: length (variable int) + data
    description: length (variable int) + data
    nftdata (optional, see nft format below): length + data

    NFT data V2 format example:
    'f701' - NFT data evalcode (f7) and version (01)
    '01' - Code of field 'ID'
    '33' - Value of field 'ID' (51) in compact size format, 65535 (example of a big value)
    '02' - Code of URL field
    '11' - URL length in hex (17 in decimal)
    '68747470733a2f2f746f6b656c2e696f2f' - url value in hex (https://tokel.io/)
    '03' - Code of Royalty % field
    '64' - 100 in hex (Value is represented as integer fraction of 1000, acceptable values are from 0 (no royalty) to 999 (max royalty of 0,999))
    '04' - Code of arbitrary data field
    '11' - Arbitrary data length in hex (17 in decimal)
    '68747470733a2f2f746f6b656c2e696f2f' - Arbitrary data value in hex (https://tokel.io/)
*/

// TODO: generalize opreturn decoding into a single function

var varuintBitcoin = require('varuint-bitcoin');
var bitcore = require('bitcore-lib-komodo');
var helpers = require('./math-helpers');

var fieldNames = [
  'name',
  'description',
  'nftData',
];
var nftByteV2 = 'f701';
var nftV2FieldBytes = [
  {
    sequence: '01',
    type: 'value',
    fieldName: 'id',
  }, {
    sequence: '02',
    type: 'length',
    fieldName: 'url',
  }, {
    sequence: '03',
    type: 'value',
    fieldName: 'royalty',
  }, {
    sequence: '04',
    type: 'length',
    fieldName: 'arbitrary',
  }
];
var oldNftPayloadNftBits = ['6af5', '6af7', '6af6', '68f7', 'd67b'];
var funcidList = {
  v2: ['53', '73', '42', '62', '78', '6f', '74', '63'],
};

var readVar = function(hex, type) {
  var varLen = varuintBitcoin.decode(Buffer.from(hex, 'hex'));
  var varHexLen = varuintBitcoin.encodingLength(varLen) * 2;
  var varDecoded = oldNftPayloadNftBits.indexOf(hex.substr(0, 4)) > -1 ? Buffer.from(hex.substr(4, hex.length), 'hex').toString().trim() : Buffer.from(hex.substr(varHexLen, varLen * 2), 'hex').toString().trim();
  //console.log(varLen)
  //console.log('varLen', varLen);
  //console.log('varHexLen', varHexLen);
  //console.log('decoded var', type === 'value' ? varLen : varDecoded);
  var hexNext = hex.substr(type === 'value' ? varHexLen : varHexLen + varLen * 2, hex.length);

  return {
    hexCurrent: hex,
    hexNext: hexNext ? hexNext : null,
    varHexLen: varHexLen,
    varLen: varLen,
    varDecoded: type === 'value' ? varLen : varDecoded,
  };
};

// ref: https://github.com/dimxy/bitgo-komodo-cc-lib/blob/master/src/bufferutils.js#L16
var verifuint = function(value, max) {
  if (typeof value !== 'number')
      throw new Error('cannot write a non-number as a number');
  if (value < 0)
      throw new Error('specified a negative value for writing an unsigned value');
  if (value > max)
      throw new Error('RangeError: value out of range');
  if (Math.floor(value) !== value)
      throw new Error('value has a fractional component');
}

var readPriceUnit = function readPriceUnit(buffer, offset) {
  var a = buffer.readUInt32LE(offset);
  var b = buffer.readUInt32LE(offset + 4);
  b *= 0x100000000;
  verifuint(b + a, 0x001fffffffffffff);
  return b + a;
}

// token create v2 NFT data decoder
var readV2NftData = function(hex) {
  var nftData = {};
  var tokenScript = hex;
  var sequenceNumbers = nftV2FieldBytes.map(x => x.sequence);
  //console.log(sequenceNumbers);
  //console.log('parse nftv2');
  tokenScript = tokenScript.substr(tokenScript.indexOf(nftByteV2) + nftByteV2.length, tokenScript.length);
  
  //console.log('drop nftv2 field bytes', tokenScript);
  // parse nft fields data
  while (tokenScript) {
    var readNftFieldBytes = tokenScript.substr(0, 2);
    //console.log('nftv2 fields bytes', readNftFieldBytes);
    //console.log(sequenceNumbers.indexOf(readNftFieldBytes.toString()))
    tokenScript = tokenScript.substr(nftV2FieldBytes[sequenceNumbers.indexOf(readNftFieldBytes)].sequence.length, tokenScript.length);
    //console.log(tokenScript)
    tokenVar = readVar(tokenScript, nftV2FieldBytes[sequenceNumbers.indexOf(readNftFieldBytes)].type);
    tokenScript = tokenVar.hexNext;
    if (tokenVar.varDecoded) nftData[nftV2FieldBytes[sequenceNumbers.indexOf(readNftFieldBytes)].fieldName] = tokenVar.varDecoded;
  }

  return Object.keys(nftData).length ? nftData : null;
}

// token create OP_RETURN decoder
var decodeTokenCreateDetails = function(transaction) {
  var isTokenCreateTx = false;
  var tokenDetails = {};
  var tokenScript = transaction.outputs[transaction.outputs.length - 1].scriptAsm;
  //console.log('script', tokenScript);
  //console.log('tokenScript.length', tokenScript.length)

  // 10 bytes opret + 66 compressed pubkey
  if (tokenScript.substr(0, 10) === 'OP_RETURN ' && tokenScript.length > 76) {
    // drop opreturn bytes
    tokenScript = tokenScript.substr(10, tokenScript.length);
    //console.log('script', tokenScript);

    // 1st byte = evalcode, 2nd byte = funcid, 3rd byte = version
    // note: version byte is embedded since V2 introduction only
    //       some old chains are running w/o version byte
    // 21 hex -> 33 dec (bytes), 66 chars compressed pubkey
    // 41 hex -> 65 dec (bytes), 130 chars uncompressed pubkey
    var evalcode = tokenScript.substr(0, 2);
    var funcid = tokenScript.substr(2, 2);
    var version = tokenScript.substr(4, 2);
    var pubkeyLenBytes;
    var pubkey;

    // old chains
    if (Number(version) === 21 || Number(version) === 41) {
      pubkeyLenBytes = parseInt(version, 16);
      pubkey = tokenScript.substr(6, pubkeyLenBytes * 2);
      version = '';
      // new chains
    } else {
      pubkeyLenBytes = parseInt(tokenScript.substr(6, 2), 16);
      pubkey = tokenScript.substr(8, pubkeyLenBytes * 2);
    }
    
    if (pubkeyLenBytes !== 33 && pubkeyLenBytes !== 65) return null;
    
    tokenScript = tokenScript.substr(evalcode.length + funcid.length + version.length + pubkeyLenBytes.toString().length + pubkey.length, tokenScript.length);

    // parse token
    var tokenVar;
    var isNftFields = false;

    for (var i = 0; i < 3; i++) {
      tokenVar = readVar(tokenScript);
      tokenScript = tokenVar.hexNext;
      if (tokenVar.varDecoded) tokenDetails[fieldNames[i]] = tokenVar.varDecoded;

      //console.log('#' + i, tokenVar)

      if (!tokenScript) {
        try {
          var parsedJson = JSON.parse(tokenVar.varDecoded);
          //console.log('nftv1 json', parsedJson);
          tokenDetails[fieldNames[i]] = parsedJson;
        } catch (e) {}
        break;
      }
    }

    //console.log('step2', tokenVar)

    if (tokenVar.hexCurrent.indexOf(nftByteV2) > -1) {
      var nftV2Data = readV2NftData(tokenVar.hexCurrent);

      if (nftV2Data) tokenDetails.nftData = nftV2Data;
    }

    tokenDetails.supply = transaction.outputs[1].satoshis;
    tokenDetails.owner = transaction.outputs[1].script;
    tokenDetails.ownerAddress = transaction.outputs[1].address;
  }

  return tokenDetails && Object.keys(tokenDetails).length ? tokenDetails : null;
}

// token decoder
var decodeOpreturn = function(transaction, extra) {
  var tokenScript = transaction.outputs[transaction.outputs.length - 1].scriptAsm;
  var royalty = 0;

  var checkExtraData = function() {
    if (extra && extra.royalty && Number(extra.royalty)) {
      royalty = extra.royalty;
      //console.log('royalty is set at ' + royalty);
    }
  }

  checkExtraData();
  
  var getFirstCCVout = function(transaction, excludeVoutSizes) {
    if (!excludeVoutSizes) excludeVoutSizes = [];

    for (var i = 0; i < transaction.outputs.length; i++) {
      if (transaction.outputs[i].scriptAsm.indexOf('OP_CHECKCRYPTOCONDITION') > -1 &&
          excludeVoutSizes.indexOf(transaction.outputs[i].satoshis) === -1 &&
          transaction.outputs[i].satoshis > 0) {
        //console.log('vout ' + i +  ', satoshis ' + transaction.outputs[i].satoshis + ' ' + transaction.outputs[i].scriptAsm)
        return i;
      }
    }
  }

  var getNormalOutputByValue = function(sats) {
    for (var i = 0; i < transaction.outputs.length; i++) {
      if (transaction.outputs[i].scriptAsm.indexOf('OP_CHECKSIG') > -1 &&
          transaction.outputs[i].satoshis === sats) {
        //console.log('normal vout ' + i +  ', satoshis ' + transaction.outputs[i].satoshis + ' ' + transaction.outputs[i].scriptAsm)
        return i;
      }
    }

    return -1;
  }

  //console.log('script', tokenScript);
  //console.log('tokenScript.length', tokenScript.length)

  // 10 bytes opret + 66 compressed pubkey
  if (tokenScript.substr(0, 10) === 'OP_RETURN ' && tokenScript.length > 76) {
    // drop opreturn bytes
    tokenScript = tokenScript.substr(10, tokenScript.length);
    //console.log('script', tokenScript);

    // 1st byte = evalcode, 2nd byte = funcid, 3rd byte = version
    var token = {
      txid: transaction.hash || transaction.txid,
      type: null,
      evalcode: tokenScript.substr(0, 2),
      funcid: tokenScript.substr(2, 2),
      version: '02'/*tokenScript.substr(4, 2)*/,
      tokenid: tokenScript.substr(6, 64),
      asset: {
        //len: tokenScript.substr(2, 2) !== '74' ? readVar(tokenScript.substr(70, 2), 'value').varDecoded : null,
        evalcode: tokenScript.substr(72, 2),
        funcid: tokenScript.substr(74, 2),
        version: tokenScript.substr(76, 2),
      },
      order: {},
      create: {},
      transfer: {},
    };
    
    if (token.funcid === '53' || token.funcid === '73') {
      token.type = 'ask';
    }

    if (token.funcid === '42' || token.funcid === '62') {
      token.type = 'bid';
    }

    if (token.funcid === '78' || token.funcid === '6f') {
      token.type = 'cancel';
    }

    if (token.funcid === '63') {
      token.type = 'create';
      // parse token
      var tokenCreateDecoded = decodeTokenCreateDetails(transaction);
      //console.log('tokenCreateDecoded', tokenCreateDecoded)
      token.create = tokenCreateDecoded;
      token.tokenid = token.txid;
    }

    if (funcidList.v2.indexOf(token.funcid) === -1) {
      var onChainHoldAddress = 'RTWtxY7GTBZ3zL8jfzyWWz1fveF3KXKBF8';
      token.version = '01';

      if (token.funcid === '54') {
        for (var a = 0; a < transaction.outputs.length; a++) {
          if (transaction.outputs[a].scriptAsm.indexOf('OP_CHECKCRYPTOCONDITION') > -1) {
            token.type = 'transfer';
            token.transfer = {
              from: transaction.inputs[1].address,
              to: transaction.outputs[0].address,
              value: transaction.outputs[0].satoshis,
            };
          }
        }
      }

      if (transaction.inputs.length === 2 && transaction.outputs[0].address === onChainHoldAddress && transaction.outputs.length >= 4) {
        //console.log('CC token onchain sell');
        token.type = 'ask';
        token.transfer = {
          from: transaction.inputs[0].address,
          to: transaction.outputs[1].address,
          value: transaction.outputs[1].satoshis,
        };
      }
      
      if (transaction.inputs[1] && transaction.inputs[1].address === onChainHoldAddress && transaction.outputs[0] && transaction.outputs[0].address === onChainHoldAddress) {
        //console.log('onchain dex fill order ');

        token.type = 'fill';
        token.transfer = {
          from: transaction.inputs[1].address,
          to: transaction.outputs[1].address,
          value: transaction.outputs[1].satoshis,
        };
        token.order = {
          price: {
            value: helpers.fromSats(transaction.outputs[2].satoshis) / transaction.outputs[1].satoshis,
          },
          amount: {
            value: transaction.outputs[1].satoshis,
          }
        };
      }
      
      if (transaction.inputs[1] && transaction.inputs[1].address == onChainHoldAddress && transaction.outputs[0] && transaction.outputs[0].address != onChainHoldAddress) {
        //console.log('onchain dex cancel order ');

        token.type = 'cancel';
        token.transfer = {
          from: transaction.inputs[1].address,
          to: transaction.outputs[0].address,
          value: transaction.outputs[0].satoshis,
        };
      }

      if (token.funcid === '43') {
        token.type = 'create';
        // parse token
        var tokenCreateDecoded = decodeTokenCreateDetails(transaction);
        //console.log('tokenCreateDecoded', tokenCreateDecoded)
        token.create = tokenCreateDecoded;
        token.tokenid = token.txid;
      }
    } else {
      if (token.asset.funcid === '53') {
        token.type = 'fillask';

        //console.log('CC token transfer from ' + transaction.inputs[transaction.inputs.length - 1].address + ' to ' + transaction.outputs[getFirstCCVout(transaction)].address + ', amount ' + transaction.outputs[getFirstCCVout(transaction)].satoshis);
        
        token.transfer = {
          from: transaction.inputs[transaction.inputs.length - 1].address,
          to: transaction.outputs[getFirstCCVout(transaction)].address,
          value: transaction.outputs[getFirstCCVout(transaction)].satoshis,
        };
      }

      if (token.asset.funcid === '73') {
        token.type = 'ask';
      }

      if (token.asset.funcid === '53') {
        token.type = 'fillask';
      }

      if (token.asset.funcid === '42') {
        token.type = 'fillbid';
      }

      if (token.asset.funcid === '62') {
        token.type = 'bid';
      }

      if (token.asset.funcid === '78') {
        token.type = 'cancelask';
      }

      if (token.asset.funcid === '6f') {
        token.type = 'cancelbid';
      }

      if (token.asset.funcid === '74') {
        token.type = 'transfer';
        // parse from -> to
        //console.log('CC token transfer from ' + transaction.inputs[transaction.inputs.length - 1].address + ' to ' + transaction.outputs[getFirstCCVout(transaction)].address + ', amount ' + transaction.outputs[getFirstCCVout(transaction)].satoshis);
        token.transfer = {
          from: transaction.inputs[transaction.inputs.length - 1].address,
          to: transaction.outputs[getFirstCCVout(transaction)].address,
          value: transaction.outputs[getFirstCCVout(transaction)].satoshis,
        };
      }

      if (token.asset.funcid === '63') {
        token.type = 'create';
        // parse token
        var tokenCreateDecoded = decodeTokenCreateDetails(transaction);
        //console.log('tokenCreateDecoded', tokenCreateDecoded)
        token.create = tokenCreateDecoded;
        token.tokenid = token.txid;
      }

      if (token.type === 'bid' || token.type === 'ask' || token.type === 'fillask' || token.type === 'fillbid'/* || token.type === 'cancelask'*/) {
        //console.log('token', token)
        //console.log('unit price hex', tokenScript.substr(78, 16))
        var assetUnitPrice = readPriceUnit(Buffer.from(tokenScript.substr(78, 16), 'hex'), 0);
        var assetRequired = token.type === 'bid' || token.type === 'fillbid' ? transaction.outputs[0].satoshis / assetUnitPrice : transaction.outputs[0].satoshis * assetUnitPrice;
        var assetAmount = assetRequired * assetUnitPrice;

        //console.log(bitcore.Unit.fromSatoshis(assetAmount).to(bitcore.Unit.BTC));
        token.order = {
          amount: {
            satoshis: assetAmount,
            value: bitcore.Unit.fromSatoshis(assetAmount).to(bitcore.Unit.BTC),
          },
          price: {
            satoshis: assetUnitPrice,
            value: bitcore.Unit.fromSatoshis(assetUnitPrice).to(bitcore.Unit.BTC),
          },
          required: {
            satoshis: assetRequired,
            value: bitcore.Unit.fromSatoshis(assetRequired).to(bitcore.Unit.BTC),
          },
        };

        if (token.type === 'fillbid' || token.type === 'ask' || token.type === 'fillask') {
          var excludedVoutSizes = [assetAmount, assetRequired];

          if (royalty && token.type !== 'ask') {
            var royaltyPercentage = royalty * 100 / 1000;

            if (royaltyPercentage / 100 * assetUnitPrice >= 1 && Number(getNormalOutputByValue(royaltyPercentage / 100 * assetUnitPrice)) > -1) {
              token.order.royalty = {
                royaltyValue: royalty,
                royaltyPercentage: royaltyPercentage,
                value: bitcore.Unit.fromSatoshis(royaltyPercentage / 100 * assetUnitPrice).to(bitcore.Unit.BTC),
                satoshis: royaltyPercentage / 100 * assetUnitPrice,
                voutIndex: getNormalOutputByValue(royaltyPercentage / 100 * assetUnitPrice), 
                receiver: {
                  pubkey: transaction.outputs[getNormalOutputByValue(royaltyPercentage / 100 * assetUnitPrice)].script,
                  address: transaction.outputs[getNormalOutputByValue(royaltyPercentage / 100 * assetUnitPrice)].address,
                },
              };
              excludedVoutSizes.push(royaltyPercentage / 100 * assetUnitPrice);
            }
          }

          token.transfer = {
            from: transaction.inputs[transaction.inputs.length - 1].address,
            to: transaction.outputs[getFirstCCVout(transaction, excludedVoutSizes)].address,
            value: transaction.outputs[getFirstCCVout(transaction, excludedVoutSizes)].satoshis,
          };
          //console.log('CC token transfer from ' + token.transfer.from + ' to ' + token.transfer.to + ', amount ' + token.transfer.value);
        }
      }

      if (!token.type && token.funcid === '74') {
        token.type = 'transfer';
        // parse from -> to
        //console.log('CC token transfer from ' + transaction.inputs[transaction.inputs.length - 1].address + ' to ' + transaction.outputs[getFirstCCVout(transaction)].address + ', amount ' + transaction.outputs[getFirstCCVout(transaction)].satoshis);
        
        token.transfer = {
          from: transaction.inputs[transaction.inputs.length - 1].address,
          to: transaction.outputs[getFirstCCVout(transaction)].address,
          value: transaction.outputs[getFirstCCVout(transaction)].satoshis,
        };
      }
    }
    
    if (!Object.keys(token.transfer).length) delete token.transfer;
    if (!Object.keys(token.order).length) delete token.order;
    if (!Object.keys(token.create).length) delete token.create;

    //console.log('token', JSON.stringify(token, null, 2));
    
    return token;
  }
}

module.exports = {
  decodeTokenCreateDetails: decodeTokenCreateDetails,
  readV2NftData: readV2NftData,
  decodeOpreturn: decodeOpreturn,
};