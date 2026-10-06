const path = require('node:path');
const webpack = require('webpack');
const workshopConfig = require('./config/workshop.json');

function entryNameFromPublicPath(publicPath) {
  const prefix = 'dist/';
  if (!publicPath.startsWith(prefix) || !publicPath.endsWith('.js')) {
    throw new Error(`Workshop publicPath must be under dist/ and end with .js: ${publicPath}`);
  }
  return publicPath.slice(prefix.length, -3);
}

function createClientConfig({ name, publicPath, entryPath, clientVersion, endpoint }) {
  return {
    name,
    target: ['web', 'es2020'],
    entry: {
      [entryNameFromPublicPath(publicPath)]: path.resolve(__dirname, entryPath),
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: false,
    },
    resolve: {
      extensions: ['.ts', '.js'],
      alias: {
        '@util': path.resolve(__dirname, 'util'),
      },
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: {
            loader: 'ts-loader',
            options: {
              transpileOnly: true,
            },
          },
        },
        {
          test: /\.html$/,
          type: 'asset/source',
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        __CREATIVE_WORKSHOP_CLIENT_VERSION__: JSON.stringify(clientVersion),
        __CREATIVE_WORKSHOP_DEFAULT_URL__: JSON.stringify(endpoint),
      }),
    ],
    optimization: {
      splitChunks: false,
      runtimeChunk: false,
      minimize: false,
    },
    devtool: 'source-map',
    performance: {
      hints: false,
    },
  };
}

module.exports = [
  createClientConfig({
    name: 'creative-workshop-stable',
    publicPath: workshopConfig.client.publicPath,
    entryPath: 'src/CreativeWorkshop/index.ts',
    clientVersion: workshopConfig.client.stable,
    endpoint: workshopConfig.endpoints.production,
  }),
  createClientConfig({
    name: 'creative-workshop-staging',
    publicPath: workshopConfig.client.stagingPublicPath,
    entryPath: 'src/CreativeWorkshop/staging.ts',
    clientVersion: workshopConfig.client.staging,
    endpoint: workshopConfig.endpoints.staging,
  }),
];
