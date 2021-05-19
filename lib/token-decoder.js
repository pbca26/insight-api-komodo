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

var varuintBitcoin = require('varuint-bitcoin');
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
  },
  {
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
  const a = buffer.readUInt32LE(offset);
  let b = buffer.readUInt32LE(offset + 4);
  b *= 0x100000000;
  verifuint(b + a, 0x001fffffffffffff);
  return b + a;
}

var readVarInt = function(hex, type) {
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

var readV2NftData = function(hex) {
  var nftData = {};
  var tokenScript = hex;
  //console.log('parse nftv2');
  tokenScript = tokenScript.substr(tokenScript.indexOf(nftByteV2) + nftByteV2.length, tokenScript.length);
  //console.log('drop nftv2 field bytes', tokenScript);
  // parse nft fields data
  for (var i = 0; i < nftV2FieldBytes.length; i++) {
    if (tokenScript &&
        tokenScript.substr(0, 2) === nftV2FieldBytes[i].sequence) {
      //console.log('field bytes', nftV2FieldBytes[i].sequence);
      tokenScript = tokenScript.substr(nftV2FieldBytes[i].sequence.length, tokenScript.length);
      //console.log(tokenScript)
      tokenVar = readVarInt(tokenScript, nftV2FieldBytes[i].type);
      tokenScript = tokenVar.hexNext;
      if (tokenVar.varDecoded) nftData[nftV2FieldBytes[i].fieldName] = tokenVar.varDecoded;
    }
  }

  return Object.keys(nftData).length ? nftData : null;
}

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
      tokenVar = readVarInt(tokenScript);
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

var decodeOpreturn = function() {
  var tokenScript = transaction.outputs[transaction.outputs.length - 1].scriptPubKey.asm;
  //console.log('script', tokenScript);
  console.log('tokenScript.length', tokenScript.length)

  // 10 bytes opret + 66 compressed pubkey
  if (tokenScript.substr(0, 10) === 'OP_RETURN ' && tokenScript.length > 76) {
    // drop opreturn bytes
    tokenScript = tokenScript.substr(10, tokenScript.length);
    console.log('script', tokenScript);

    // 1st byte = evalcode, 2nd byte = funcid, 3rd byte = version
    var token = {
      type: null,
      evalcode: tokenScript.substr(0, 2),
      funcid: tokenScript.substr(2, 2),
      version: tokenScript.substr(4, 2),
      tokenid: tokenScript.substr(6, 64),
      asset: {
        type: null,
        len: funcid !== '74' ? readVar(tokenScript.substr(70, 2), 'value').varDecoded : null,
        evalcode: tokenScript.substr(72, 2),
        funcid: tokenScript.substr(74, 2),
        version: tokenScript.substr(76, 2),
        order: {},
        create: {},
        transfer: {},
      },
    };
    var assetType;
    var evalcode = tokenScript.substr(0, 2);
    var funcid = tokenScript.substr(2, 2);
    var version = tokenScript.substr(4, 2);
    var tokenId = tokenScript.substr(6, 64);
    var assetLen = funcid !== '74' ? readVar(tokenScript.substr(70, 2), 'value').varDecoded : null;
    var assetEvalcode = tokenScript.substr(72, 2);
    var assetFuncid = tokenScript.substr(74, 2);
    var assetVersion = tokenScript.substr(76, 2);
    var assetUnitPrice;
    var assetRequired;
    var assetAmount;
    var assetDataType;
    
    if (token.funcid === '53' || token.funcid === '73') {
      token.assetType = 'ask';
    }

    if (token.funcid === '42' || token.funcid === '62') {
      token.assetType = 'bid';
    }

    if (token.funcid === '78' || token.funcid === '6f') {
      token.assetType = 'cancel';
    }

    if (token.funcid === '74') {
      token.assetType = 'transfer';
      // parse from -> to
      if (transaction.inputs[1]) {
        var sender = transaction.inputs[1].address;
        var receiver = transaction.outputs[1].address;
        console.log('CC token transfer from ' + transaction.inputs[1].address + ' to ' + transaction.outputs[0].address + ', amount ' + transaction.outputs[0].valueSat);
        
        token.transfer = {
          from: transaction.inputs[1].address,
          to: transaction.outputs[0].address,
          value: transaction.outputs[0].valueSat,
        };
      }
    }

    if (funcid === '63') {
      assetDataType = 'create';
      // parse token
      var tokenCreateDecoded = decodeTokenCreateDetails(transaction);
      console.log('tokenCreateDecoded', tokenCreateDecoded)
      token.create = tokenCreateDecoded;
    }

    if (funcidList.v2.indexOf(funcid) === -1) {
      console.log('token v1');
    } else {
      if (assetFuncid === '53') {
        assetDataType = 'fillask';
      }

      if (assetFuncid === '73') {
        assetDataType = 'ask';
      }

      if (assetFuncid === '42') {
        assetDataType = 'fillbid';
        // parse from -> to
        var sender = transaction.inputs[1].address;
        var receiver = transaction.outputs[1].address;
        console.log('CC token transfer from ' + transaction.inputs[1].address + ' to ' + transaction.outputs[2].address + ', amount ' + transaction.outputs[2].valueSat);

        token.transfer = {
          from: transaction.inputs[1].address,
          to: transaction.outputs[2].address,
          value: transaction.outputs[2].valueSat,
        };
      }

      if (assetFuncid === '62') {
        assetDataType = 'bid';
      }

      if (assetFuncid === '78' || assetFuncid === '6f') {
        assetDataType = 'cancel';
      }

      if (assetFuncid === '74') {
        assetDataType = 'transfer';
        // parse from -> to
        var sender = transaction.inputs[1].address;
        var receiver = transaction.outputs[1].address;
        console.log('CC token transfer from ' + transaction.inputs[1].address + ' to ' + transaction.outputs[0].address + ', amount ' + transaction.outputs[0].valueSat);
      }

      if (assetFuncid === '63') {
        assetDataType = 'create';
        // parse token
        var tokenCreateDecoded = tokenCreateDecoder.decodeTokenDetails(transaction);
        console.log('tokenCreateDecoded', tokenCreateDecoded)
        token.create = tokenCreateDecoded;
      }

      if (assetDataType === 'bid' || assetDataType === 'ask' || assetDataType === 'fillask' || assetDataType === 'cancel') {
        console.log(tokenScript.substr(78, 8))
        var assetUnitPrice = readPriceUnit(Buffer.from(tokenScript.substr(78, 16), 'hex'), 0);
        var assetRequired = assetDataType === 'bid' ? transaction.outputs[0].valueSat / assetUnitPrice : transaction.outputs[0].valueSat * assetUnitPrice;
        var assetAmount = assetRequired * assetUnitPrice;

        console.log(bitcore.Unit.fromSatoshis(assetAmount).to(bitcore.Unit.BTC));
        token.order = {
          amount: {
            satoshis: assetAmount,
            value: bitcore.Unit.fromSatoshis(assetAmount).to(bitcore.Unit.BTC),
          },
          price: {
            satoshis: assetUnitPrice,
            value: bitcore.Unit.fromSatoshis(assetUnitPrice).to(bitcore.Unit.BTC),
          },
          required: assetRequired,
        };
      }
    }

    return {
      evalcode,
      funcid,
      version,
      tokenId,
      assetType,
      assetLen,
      assetEvalcode,
      assetFuncid,
      assetDataType,
      assetVersion,
      assetUnitPrice,
      assetRequired,
      assetAmount,
    };
  }
}

module.exports = {
  decodeTokenCreateDetails: decodeTokenCreateDetails,
  readV2NftData: readV2NftData,
  decodeOpreturn: decodeOpreturn,
};