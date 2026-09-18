import { homeScript } from './home/app';
import { homeShellStyles } from './home/shell-styles';
import { homeStyles } from './home/styles';

export const homePage = (): string => {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0f1012">
  <title>命定创意工坊 · 主页</title>
  <style>html,body{margin:0;min-height:100%;background:#0f1012;color:#ececea}body{min-height:100vh}</style>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/lxgw-wenkai-lite-webfont@1.7.0/style.css">
  <style>${homeStyles}${homeShellStyles}</style>
</head>
<body>
  <div class="container" id="app"></div>
  <script src="/assets/home.js"></script>
</body>
</html>`;
};

export const homeScriptPage = (): string => homeScript;
