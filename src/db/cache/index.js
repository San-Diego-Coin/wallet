/* eslint-disable arrow-parens */
/* eslint-disable no-undef */
/* eslint-disable no-unused-vars */
import config from 'config';
import { createClient } from 'redis';
import { promisify } from 'util';
import { log } from 'server/utils/loggers';

const env = config.get('redis_env');
const EXPIRED_TIME = 60 * 60; // second
const redisUrl = config.get('redis_url');
const client = new createClient({ url: redisUrl });
const getAsync = promisify(client.get).bind(client);
const setAsync = promisify(client.set).bind(client);
const hgetallAsync = promisify(client.hgetall).bind(client);
const hmsetAsync = promisify(client.hmset).bind(client);
const hgetAsync = promisify(client.hget).bind(client);
const hsetAsync = promisify(client.hset).bind(client);
const delAsync = promisify(client.del).bind(client);
const expireAsync = promisify(client.expire).bind(client);

client.on('error', err => {
    console.error('redis_error:', err.code);
});

function* getRecordCache(
    model,
    conditions = {},
    field = null,
    cacheAll = true
) {
    if (!model) {
        return null;
    }
    if (conditions === {}) {
        return null;
    }

    const keyPrefix = model.getCachePrefix();
    const fields = model.getCacheFields();
    const conditionsStr = parseResultToArr(conditions).join('_');
    const cacheKey = `${keyPrefix}${conditionsStr}_${
        cacheAll ? '_all_fields' : ''
    }`;
    let result;
    try {
        // get all items

        if (!field) {
            result =
                env === 'production'
                    ? yield hgetallAsync(cacheKey)
                    : log('getRecordCache', { msg: 'non_production' });
            if (!result) {
                // not hit cache
                log('getRecordCache', {
                    msg: 'not_hit_get_all_item_cache',
                    cacheKey,
                });
                const dbOptions = {
                    where: conditions,
                };
                if (cacheAll === false) {
                    dbOptions.attributes = fields;
                }
                result = yield model.findOne(dbOptions);
                if (result === null) return null;
                result = result.get();
                if (env === 'production') {
                    yield hmsetAsync(cacheKey, ...parseResultToArr(result));
                    yield expireAsync([cacheKey, EXPIRED_TIME]);
                } else {
                    log('getRecordCache', { msg: 'non_production' });
                }
            }
            return parseNullToEmptyString(result);
        }
        // get one item
        if (cacheAll === false) {
            if (fields.indexOf(field) === -1) {
                return null;
            }
        }

        result =
            env === 'production'
                ? yield hgetAsync(cacheKey, field)
                : log('getRecordCache', { msg: 'non_production' });
        if (!result) {
            // not hit cache
            log('getRecordCache', {
                msg: 'not_hit_get_one_item_cache',
                cacheKey,
            });
            const dbOptions = {
                where: conditions,
            };
            if (cacheAll === false) {
                dbOptions.attributes = fields;
            }
            result = yield model.findOne(dbOptions);
            if (result === null) return null;
            result = result.get();
            if (env === 'production') {
                yield hmsetAsync(cacheKey, ...parseResultToArr(result));
                yield expireAsync([cacheKey, EXPIRED_TIME]);
            } else {
                log('getRecordCache', { msg: 'non_production' });
            }
        }
        return parseNullToEmptyString(result);
    } catch (e) {
        log('getRecordCache', { msg: e.message, cacheKey });
        return null;
    }
}

function parseResultToArr(result = {}) {
    const nResult = [];
    Object.keys(result).forEach(k => {
        nResult.push(k);
        nResult.push(result[k] === null ? '' : result[k]);
    });
    return nResult;
}

function parseNullToEmptyString(result = {}) {
    const r = {};
    Object.keys(result).forEach(k => {
        r[k] = result[k] === null ? '' : result[k];
    });
    return r;
}

function* updateRecordCache(
    model,
    conditions = {},
    data = [],
    cacheAll = true
) {
    if (env !== 'production') {
        log('updateRecordCache', { msg: 'non_production' });
        return false;
    }
    if (conditions.length <= 0) return false;
    const keyPrefix = model.getCachePrefix();
    const conditionsStr = parseResultToArr(conditions).join('_');
    const cacheKey = `${keyPrefix}${conditionsStr}_${
        cacheAll ? '_all_fields' : ''
    }`;
    try {
        if (data !== []) {
            yield hmsetAsync(cacheKey, ...data);
            yield expireAsync([cacheKey, EXPIRED_TIME]);
        }
        return true;
    } catch (e) {
        log('updateRecordCache', { msg: e.message, cacheKey });
        return false;
    }
}

function* getRecordCache2(model, conditions = {}) {
    if (!model) {
        return null;
    }
    if (conditions === {}) {
        return null;
    }

    const keyPrefix = model.getCachePrefix();
    const conditionsStr = parseResultToArr(conditions).join('_');
    const cacheKey = `${keyPrefix}${conditionsStr}`;

    let result;
    try {
        result =
            env === 'production'
                ? yield getAsync(cacheKey)
                : log('getRecordCache2', { msg: 'none_production' });
        if (!result) {
            // not hit cache
            log('getRecordCache2', {
                msg: 'not_hit_cache',
                cacheKey,
            });
            const dbOptions = {
                where: conditions,
            };
            result = yield model.findOne(dbOptions);
            if (result === null) return null;
            result = result.get();
            if (env === 'production') {
                yield setAsync(cacheKey, JSON.stringify(result));
                yield expireAsync([cacheKey, EXPIRED_TIME]);
            }
            return parseNullToEmptyString(result);
        }
        return parseNullToEmptyString(JSON.parse(result));
    } catch (e) {
        log('getRecordCache2', { msg: e.message, cacheKey });
        return null;
    }
}

function* updateRecordCache2(model, conditions = {}) {
    if (env !== 'production') {
        log('updateRecordCache2', { msg: 'none_production' });
        return false;
    }

    if (conditions.length <= 0) return false;

    const keyPrefix = model.getCachePrefix();
    const conditionsStr = parseResultToArr(conditions).join('_');
    const cacheKey = `${keyPrefix}${conditionsStr}`;

    try {
        const dbOptions = {
            where: conditions,
        };
        let result = yield model.findOne(dbOptions);
        if (result === null) {
            yield delAsync(cacheKey);
            return true;
        }
        result = result.get();
        if (env === 'production') {
            yield setAsync(cacheKey, JSON.stringify(result));
            yield expireAsync([cacheKey, EXPIRED_TIME]);
        }
        return true;
    } catch (e) {
        log('updateRecordCache2', { msg: e.message, cacheKey });
        return false;
    }
}

module.exports = {
    getRecordCache,
    updateRecordCache,
    parseResultToArr,
    parseNullToEmptyString,
    getRecordCache2,
    updateRecordCache2,
};
