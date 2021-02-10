// ref: http://blog.davidjs.com/2018/07/convert-exponential-numbers-to-decimal-in-javascript/
var convertExponentialToDecimal = function(exponentialNumber) {
  // sanity check - is it exponential number
  var str = exponentialNumber.toString();
  if (str.indexOf('e') !== -1) {
    var exponent = parseInt(str.split('-')[1], 10);
    // Unfortunately I can not return 1e-8 as 0.00000001, because even if I call parseFloat() on it,
    // it will still return the exponential representation
    // So I have to use .toFixed()
    var result = exponentialNumber.toFixed(exponent);
    return result;
  } else {
    return exponentialNumber;
  }
}

var fromSats = function(value) {
  return convertExponentialToDecimal(Number(Number(value * 0.00000001).toFixed(8)));
}

module.exports = {
  fromSats: fromSats
};