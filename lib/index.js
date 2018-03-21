'use strict';

/**
 * Module dependencies.
 */

var integration = require('@segment/analytics.js-integration');
var foldl = require('@ndhoule/foldl');
var each = require('@ndhoule/each');
var reject = require('reject');
var dateformat = require('dateformat');
var Track = require('segmentio-facade').Track;

/**
 * Custom modification to allow the silo of FB Pixel events triggered by analytics.js
 *
 * Function to coordinate sending the correct Pixel event based off of Destination settings.
 * Primary goal is to switch between track/trackCustom and trackSingle/trackSingleCustom based off of the options.onlyTrackSingle flag
 * When options.onlyTrackSingle is true, this prevents other FB Pixels loaded on the page from also sending events managed by the configured destination.
 * pixelId is only required for trackSingle and trackSingleCustom, but it's safe to always pass it in.
 *
 * @param {string} type
 * @param {string} pixelId
 * @param {string} eventName
 * @param {object} customData
 * @param {boolean} isSingle
 */

var fbPixelId = null;
var fbSendAsSingle = false;

var superTrack = function(type, pixelId, eventName, customData, isSingle) {
  var sendTrack = function(ty) {
    console.log(fbPixelId, fbSendAsSingle);
    if (isSingle) {
      if (customData && pixelId) {
        window.fbq(ty, pixelId, eventName, customData);
      } else {
        window.fbq(ty, pixelId, eventName);
      }
    } else if (!isSingle) {
      if (customData) {
        window.fbq(ty, eventName, customData);
      } else {
        window.fbq(ty, eventName);
      }
    }
  };
  if (isSingle) {
    if (type === 'track') {
      sendTrack('trackSingle');
    }
    if (type === 'trackCustom') {
      sendTrack('trackSingleCustom');
    }
  } else {
    if (type === 'track') {
      sendTrack('track');
    }
    if (type === 'trackCustom') {
      sendTrack('trackCustom');
    }
  }
};
/**
 * Expose `Facebook Pixel`.
 */

var FacebookPixel = module.exports = integration('Facebook Pixel')
  .global('fbq')
  .option('pixelId', '')
  .option('agent', 'seg')
  .option('initWithExistingTraits', false)
  .option('onlyTrackSingle', false)
  .mapping('standardEvents')
  .mapping('legacyEvents')
  .tag('<script src="//connect.facebook.net/en_US/fbevents.js">');

/**
 * Initialize Facebook Pixel.
 *
 * @param {Facade} page
 */

FacebookPixel.prototype.initialize = function() {
  window._fbq = function() {
    if (window.fbq.callMethod) {
      window.fbq.callMethod.apply(window.fbq, arguments);
    } else {
      window.fbq.queue.push(arguments);
    }
  };
  window.fbq = window.fbq || window._fbq;
  window.fbq.push = window.fbq;
  window.fbq.loaded = true;
  window.fbq.disablePushState = true; // disables automatic pageview tracking
  window.fbq.agent = this.options.agent;
  window.fbq.version = '2.0';
  window.fbq.queue = [];
  fbPixelId = this.options.fbPixelId;
  fbSendAsSingle = this.options.onlyTrackSingle;
  this.load(this.ready);
  if (this.options.initWithExistingTraits) {
    var traits = formatTraits(this.analytics);
    window.fbq('init', this.options.pixelId, traits);
  } else {
    window.fbq('init', this.options.pixelId);
  }
};

/**
 * Has the Facebook Pixel library been loaded yet?
 *
 * @return {Boolean}
 */

FacebookPixel.prototype.loaded = function() {
  return !!(window.fbq && window.fbq.callMethod);
};

/**
 * Trigger a page view.
 *
 * @param {Facade} identify
 */

FacebookPixel.prototype.page = function() {
  superTrack('track', this.options.pixelId, 'PageView', null, this.options.onlyTrackSingle);
};

/**
 * Track an event.
 *
 * @param {Facade} track
 */

FacebookPixel.prototype.track = function(track) {
  var event = track.event();
  var revenue = formatRevenue(track.revenue());
  var pixelId = this.options.pixelId;
  var isSingle = this.options.onlyTrackSingle;

  var payload = foldl(function(acc, val, key) {
    if (key === 'revenue') {
      acc.value = revenue;
      return acc;
    }

    acc[key] = val;
    return acc;
  }, {}, track.properties());

  var standard = this.standardEvents(event);
  var legacy = this.legacyEvents(event);

  // non-mapped events get sent as "custom events" with full
  // tranformed payload
  if (![].concat(standard, legacy).length) {
    superTrack('trackCustom', pixelId, event, payload, isSingle);
    // window.fbq('trackSingleCustom', pixelId, event, payload);
    return;
  }

  // standard conversion events, mapped to one of 9 standard events
  // "Purchase" requires a currency parameter;
  // send full transformed payload
  each(function(event) {
    if (event === 'Purchase') payload.currency = track.currency(); // defaults to 'USD'
    superTrack('track', pixelId, event, payload, isSingle);
    // window.fbq('trackSingle', pixelId, event, payload);
  }, standard);

  // legacy conversion events — mapped to specific "pixelId"s
  // send only currency and value
  each(function(event) {
    superTrack('track', pixelId, event, {
      currency: track.currency(),
      value: revenue
    }, isSingle);
  }, legacy);
};

/**
 * Product List Viewed.
 *
 * @api private
 * @param {Track} track category
 */

FacebookPixel.prototype.productListViewed = function(track) {
  var pixelId = this.options.pixelId;
  var isSingle = this.options.onlyTrackSingle;

  superTrack('track', pixelId, 'ViewContent', {
    content_ids: [track.category() || ''],
    content_type: 'product_group'
  }, isSingle);

  // fall through for mapped legacy conversions
  each(function(event) {
    superTrack('track', pixelId, event, {
      currency: track.currency(),
      value: formatRevenue(track.revenue())
    }, isSingle);
  }, this.legacyEvents(track.event()));
};

/**
 * Product viewed.
 *
 * @api private
 * @param {Track} track
 */

FacebookPixel.prototype.productViewed = function(track) {
  var pixelId = this.options.pixelId;
  var isSingle = this.options.onlyTrackSingle;
  superTrack('track', pixelId, 'ViewContent', {
    content_ids: [track.productId() || track.id() || track.sku() || ''],
    content_type: 'product',
    content_name: track.name() || '',
    content_category: track.category() || '',
    currency: track.currency(),
    value: formatRevenue(track.price())
  }, isSingle);

  // fall through for mapped legacy conversions
  each(function(event) {
    superTrack('track', pixelId, event, {
      currency: track.currency(),
      value: formatRevenue(track.revenue())
    }, isSingle);
  }, this.legacyEvents(track.event()));
};

/**
 * Product added.
 *
 * @api private
 * @param {Track} track
 */

FacebookPixel.prototype.productAdded = function(track) {
  var pixelId = this.options.pixelId;
  var isSingle = this.options.onlyTrackSingle;

  superTrack('track', pixelId, 'AddToCart', {
    content_ids: [track.productId() || track.id() || track.sku() || ''],
    content_type: 'product',
    content_name: track.name() || '',
    content_category: track.category() || '',
    currency: track.currency(),
    value: formatRevenue(track.price())
  }, isSingle);

  // fall through for mapped legacy conversions
  each(function(event) {
    superTrack('track', pixelId, event, {
      currency: track.currency(),
      value: formatRevenue(track.revenue())
    }, isSingle);
  }, this.legacyEvents(track.event()));
};

/**
 * Order Completed.
 *
 * @api private
 * @param {Track} track
 */

FacebookPixel.prototype.orderCompleted = function(track) {
  var pixelId = this.options.pixelId;
  var isSingle = this.options.onlyTrackSingle;

  var content_ids = foldl(function(acc, product) {
    var item = new Track({ properties: product });
    var key = item.productId() || item.id() || item.sku();
    if (key) acc.push(key);
    return acc;
  }, [], track.products() || []);

  var revenue = formatRevenue(track.revenue());

  superTrack('track', pixelId, 'Purchase', {
    content_ids: content_ids,
    content_type: 'product',
    currency: track.currency(),
    value: revenue
  }, isSingle);

  // fall through for mapped legacy conversions
  each(function(event) {
    superTrack('track', pixelId, event, {
      currency: track.currency(),
      value: formatRevenue(track.revenue())
    }, isSingle);
  }, this.legacyEvents(track.event()));
};


/**
 * Get Revenue Formatted Correctly for FB.
 *
 * @api private
 * @param {Track} track
 */

function formatRevenue(revenue) {
  return Number(revenue || 0).toFixed(2);
}

/**
 * Get Traits Formatted Correctly for FB.
 *
 * https://developers.facebook.com/docs/facebook-pixel/pixel-with-ads/conversion-tracking#advanced_match
 *
 * @api private
 */

function formatTraits(analytics) {
  var traits = analytics && analytics.user().traits();
  if (!traits) return {};
  var firstName;
  var lastName;
  // Check for firstName property
  // else check for name
  if (traits.firstName) {
    firstName = traits.firstName;
    lastName = traits.lastName;
  } else {
    var nameArray = traits.name && traits.name.toLowerCase().split(' ') || [];
    firstName = nameArray.shift();
    lastName = nameArray.pop();
  }
  var gender = traits.gender && traits.gender.slice(0,1).toLowerCase();
  var birthday = traits.birthday && dateformat(traits.birthday, 'yyyymmdd');
  var address = traits.address || {};
  var city = address.city && address.city.split(' ').join('').toLowerCase();
  var state = address.state && address.state.toLowerCase();
  var postalCode = address.postalCode;
  return reject({
    em: traits.email,
    fn: firstName,
    ln: lastName,
    ph: traits.phone,
    ge: gender,
    db: birthday,
    ct: city,
    st: state,
    zp: postalCode
  });
}
