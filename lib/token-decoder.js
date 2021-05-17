/* 
  Tokens CC OP_RETURN format

  Variable int format is described here https://en.bitcoin.it/wiki/Protocol_documentation#Variable_length_integer

  evalcode: 1 byte
  funcid: 1 byte
  version: 1 byte
  creator-pubkey: length (variable int) + data
  name: length (variable int) + data
  description: length (variable int) + data
  nftdata (optional, see nft format below): length + data

  NFT data V2 format:
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
      tokenVar = readVar(tokenScript, nftV2FieldBytes[i].type);
      tokenScript = tokenVar.hexNext;
      if (tokenVar.varDecoded) nftData[nftV2FieldBytes[i].fieldName] = tokenVar.varDecoded;
    }
  }

  return Object.keys(nftData).length ? nftData : null;
}

var decodeTokenDetails = function(transaction) {
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

module.exports = {
  decodeTokenDetails: decodeTokenDetails,
  readV2NftData: readV2NftData,
};