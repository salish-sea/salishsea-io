import { merge } from 'webpack-merge';
import { distDir, commonConfig } from './webpack.common.js';

const config = {
  mode: 'development',
  devtool: 'inline-source-map',
  devServer: {
    hot: false,
    static: {
      directory: distDir,
    },
    compress: true,
    port: 9000,
  },
};

export default merge(commonConfig, config);
