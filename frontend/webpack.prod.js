import { merge } from 'webpack-merge';
import {commonConfig} from './webpack.common.js';

export default merge(commonConfig, {
  devtool: 'source-map',
  mode: 'production',
});
