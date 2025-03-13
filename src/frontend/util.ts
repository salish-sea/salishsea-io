import {Temporal} from 'temporal-polyfill';

export const queryStringAppend = (base: string, attrs: {[k: string]: string | string[] | number | number[] | Temporal.Instant}) => {
  let queryString = Object.entries(attrs).map(([key, value]) => {
    value = Array.isArray(value) ? value.join(',') : value.toString();
    return `${key}=${value}`;
  }).join('&');
  return base + (base.indexOf('?') === -1 ? '?' : '&') + queryString;
}
