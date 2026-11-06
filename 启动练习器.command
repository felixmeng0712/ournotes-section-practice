#!/bin/bash
# 双击运行：启动本地服务器（会把谱面/音乐缓存到 data/，之后可离线），电脑浏览器自动打开。
cd "$(dirname "$0")"
PORT=8000
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo "电脑： http://localhost:$PORT"
[ -n "$IP" ] && echo "手机/平板（同一 Wi-Fi）： http://$IP:$PORT"
echo "关闭这个窗口即停止。"
(sleep 1; open "http://localhost:$PORT") &
exec python3 server.py --port $PORT
