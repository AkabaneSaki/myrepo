import { homeScript } from './home/app';
import { homeStyles } from './home/styles';

export const homePage = (): string => {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>命定创意工坊 · 主页</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
  <style>${homeStyles}</style>
</head>
<body>
  <div class="container" id="app"></div>
  <script src="/assets/home.js"></script>
</body>
</html>`;
};

export const homeScriptPage = (): string => homeScript;
