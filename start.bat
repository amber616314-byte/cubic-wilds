@echo off
rem 方块世界 — 可选启动方式：本地服务器 + 浏览器（直接双击 index.html 也可玩）
cd /d "%~dp0"
start "" http://localhost:8000/index.html
python -m http.server 8000
