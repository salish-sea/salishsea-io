import HtmlWebpackPlugin from 'html-webpack-plugin';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const distDir = resolve(__dirname, 'dist');

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
