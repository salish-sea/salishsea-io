import HtmlWebpackPlugin from 'html-webpack-plugin';
import { resolve } from 'path';

export const distDir = resolve(import.meta.dirname, 'dist');

export const commonConfig = {
  entry: './src/index.ts',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  optimization: {
    usedExports: true,
  },
  output: {
    filename: 'bundle.js',
    path: distDir,
  },
  plugins: [
    new HtmlWebpackPlugin({
      hash: true,
      meta: {
        viewport: 'width=device-width, initial-scale=1, shrink-to-fit=no',
      },
      title: 'Salish Sea Explorer',
    }),
  ],
  resolve: {
    extensions: ['.tsx', '.ts', '.js']
  }
}
