// external dependencies
var request = require('request');
var builder = require('xmlbuilder');
var xml2js = require('xml2js');

// internal dependencies
var USPSError = require('./error.js');

var usps = module.exports = function(config) {
  if (!(config && config.server && config.userId)) {
    throw 'Error: must pass usps server url and userId';
  }
  if (!config.ttl) {
    config.ttl = 100000;
  }

  this.config = config;
};

/**
  Verifies an address

  @param {Object} address The address to be verified
  @param {String} address.street1 Street
  @param {String} [address.street2] Secondary street (apartment, etc)
  @param {String} address.city City
  @param {String} address.state State (two-letter, capitalized)
  @param {String} address.zip Zipcode
  @param {Function} callback The callback function
  @returns {Object} instance of module
*/
usps.prototype.verify = function(address, callback) {
  var obj = {
    Revision: 1,
    Address: {
      FirmName: address.firm_name,
      Address1: address.street2 || '',
      Address2: address.street1,
      City: address.city,
      State: address.state,
      Zip5: address.zip,
      Zip4: address.zip4 || ''
    }
  };

  if (address.urbanization) {
    obj.Address.Urbanization = address.urbanization;
  }

  callUSPS('Verify', 'AddressValidate', 'Address', this.config, obj, function(err, address) {
    if (err) {
      callback(err);
      return;
    }

    var result = {
      street1: address.Address2,
      street2: address.Address1 || '',
      city: address.City,
      zip: address.Zip5,
      state: address.State,
      zip4: address.Zip4
    };

    var optional = {
      FirmName: 'firm_name',
      Address2Abbreviation: 'address2_abbreviation',
      CityAbbreviation: 'city_abbreviation',
      Urbanization: 'urbanization',
      DeliveryPoint: 'delivery_point',
      CarrierRoute: 'carrier_route',
      Footnotes: 'footnotes',
      DPVConfirmation: 'dpv_confirmation',
      DPVCMRA: 'dpvcmra',
      DPVFalse: 'dpv_false',
      DPVFootnotes: 'dpv_footnotes',
      Business: 'business',
      CentralDeliveryPoint: 'central_delivery_point',
      Vacant: 'vacant',
    };

    Object.keys(optional).forEach(function(key) {
      var resultKey = optional[key];
      if (address[key]) {
        result[resultKey] = address[key];
      }
    });

    callback(null, result);
  });

  return this;
};

/**
  Looks up a zipcode, given an address

  @param {Object} address Address to find zipcode for
  @param {String} address.street1 Street
  @param {String} [address.street2] Secondary street (apartment, etc)
  @param {String} address.city City
  @param {String} address.state State (two-letter, capitalized)
  @param {String} address.zip Zipcode
  @param {Function} callback The callback function
  @returns {Object} instance of module
*/
usps.prototype.zipCodeLookup = function(address, callback) {
  var obj = {
    Address: {
      Address1: address.street2 || '',
      Address2: address.street1,
      City: address.city,
      State: address.state
    }
  };

  callUSPS('ZipCodeLookup', 'ZipCodeLookup', 'Address', this.config, obj, function(err, address) {
    if (err) {
      callback(err);
      return;
    }

    callback(null, {
      street1: address.Address2,
      street2: address.Address1 ? address.Address1 : '',
      city: address.City,
      state: address.State,
      zip: address.Zip5 + '-' + address.Zip4
    });
  });

  return this;
};


/**
  Pricing Rate Lookup, based on USPS RateV4

  @param {Object} information about pricing Rate
  @param {Function} callback The callback function
  @returns {Object} instance of module
*/
usps.prototype.pricingRateV4 = function(pricingRate, callback) {
  "use strict";
  var obj = {
    Package: {
      '@ID': '1ST',
      Service: pricingRate.Service || 'PRIORITY',
      ZipOrigination: pricingRate.ZipOrigination || 55401,
      ZipDestination: pricingRate.ZipDestination,
      Pounds: pricingRate.Pounds,
      Ounces: pricingRate.Ounces,
      Container: pricingRate.Container,
      Size: pricingRate.Size,
      Width: pricingRate.Width,
      Length: pricingRate.Length,
      Height: pricingRate.Height,
      Girth: pricingRate.Girth,
      Machinable: pricingRate.Machinable,
    }
  };

  callUSPS('RateV4', 'RateV4', 'Package', this.config, obj, function(err, result) {
    if (err) {
      callback(err);
      return;
    }

    callback(null, result.Postage);
  });
  return this;
};

/**
  City State lookup, based on zip

  @param {String} zip Zipcode to retrieve city & state for
  @param {Function} callback The callback function
  @returns {Object} instance of module
*/
usps.prototype.cityStateLookup = function(zip, callback) {
  var obj = {
    ZipCode: {
      Zip5: zip
    }
  };

  callUSPS('CityStateLookup', 'CityStateLookup', 'ZipCode', this.config, obj, function(err, address) {
    if (err) {
      callback(err);
      return;
    }

    callback(err, {
      city: address.City,
      state: address.State,
      zip: address.Zip5
    });
  });
};

/**
  Method to call USPS
*/
function callUSPS(api, method, property, config, params, callback) {
  var requestName = method + 'Request';
  var responseName = method + 'Response';

  var obj = {};
  obj[requestName] = params;
  obj[requestName]['@USERID'] = config.userId;

  var xml = builder.create(obj).end();

  var opts = {
    url: config.server,
    qs: {
      API: api,
      XML: xml
    },
    timeout: config.ttl,
  };

  request(opts, function(err, res, body) {
    if (err) {
      callback(new USPSError(err.message, err, {
        method: api,
        during: 'request'
      }));
      return;
    }

    xml2js.parseString(body, { explicitArray: false }, function(err, result) {
      var errMessage;

      if (err) {
        callback(new USPSError(err.message, err, {
          method: api,
          during: 'xml parse'
        }));
        return;
      }

      // may have a root-level error
      if (result.Error) {
        try {
          errMessage = result.Error.Description.trim();
        } catch (e) {
          errMessage = result.Error;
        }

        callback(new USPSError(errMessage, result.Error));
        return;
      }

      /**
        walking the result, to drill into where we want
        resultDotNotation looks like 'key.key'
        though it may actually have arrays, so returning first cell
      */

      var specificResult = {};
      if (result && result[responseName] && result[responseName][property]) {
        specificResult = result[responseName][property];
      }

      // specific error handling
      if (specificResult.Error) {
        try {
          errMessage = specificResult.Error.Description.trim();
        } catch (e) {
          errMessage = specificResult.Error;
        }

        callback(new USPSError(errMessage, specificResult.Error));
        return;
      }

      // just peachy
      callback(null, specificResult);
    });
  });
}