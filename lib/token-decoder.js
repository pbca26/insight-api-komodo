var varuintBitcoin = require('varuint-bitcoin');

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

    var readVar = (hex, type) => {
      const varLen = varuintBitcoin.decode(Buffer.from(hex, 'hex'));
      const varHexLen = varuintBitcoin.encodingLength(varLen) * 2;
      const varDecoded = Buffer.from(tokenScript.substr(varHexLen, varLen * 2), 'hex').toString().trim();
      //console.log(varLen)
      //console.log('varLen', varLen);
      //console.log('varHexLen', varHexLen);
      //console.log('decoded var', type === 'value' ? varLen : varDecoded);
      const hexNext = tokenScript.substr(type === 'value' ? varHexLen : varHexLen + varLen * 2, hex.length);

      return {
        hexCurrent: hex,
        hexNext: hexNext ? hexNext : null,
        varHexLen: varHexLen,
        varLen: varLen,
        varDecoded: type === 'value' ? varLen : varDecoded,
      };
    };

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
          const parsedJson = JSON.parse(tokenVar.varDecoded);
          //console.log('nftv1 json', parsedJson);
          tokenDetails[fieldNames[i]] = parsedJson;
        } catch (e) {}
        break;
      }
    }

    //console.log('step2', tokenVar)

    if (tokenVar.hexCurrent.indexOf(nftByteV2) > -1) {
      tokenDetails.nftData = {};
      tokenScript = tokenVar.hexCurrent;
      //console.log('parse nftv2');
      tokenScript = tokenScript.substr(tokenScript.indexOf(nftByteV2) + nftByteV2.length, tokenScript.length);
      //console.log('drop nftv2 field bytes', tokenScript);
      // parse nft fields data
      for (let i = 0; i < nftV2FieldBytes.length; i++) {
        if (tokenScript &&
            tokenScript.substr(0, 2) === nftV2FieldBytes[i].sequence) {
          //console.log('field bytes', nftV2FieldBytes[i].sequence);
          tokenScript = tokenScript.substr(nftV2FieldBytes[i].sequence.length, tokenScript.length);
          //console.log(tokenScript)
          tokenVar = readVar(tokenScript, nftV2FieldBytes[i].type);
          tokenScript = tokenVar.hexNext;
          if (tokenVar.varDecoded) tokenDetails.nftData[nftV2FieldBytes[i].fieldName] = tokenVar.varDecoded;
        }
      }
    }

    tokenDetails.supply = transaction.outputs[1].satoshis;
    tokenDetails.owner = transaction.outputs[1].script;
    tokenDetails.ownerAddress = transaction.outputs[1].address;
    
    //console.log('tokenDetails', tokenDetails)
  }

  return tokenDetails && Object.keys(tokenDetails).length ? tokenDetails : null;
}

module.exports = decodeTokenDetails;