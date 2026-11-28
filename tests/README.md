共通APIの回帰テストです。EDCBサーバーへの接続や録画・設定の変更は行いません。
リポジトリのルートで実行してください。

```sh
node --test tests/common-api.test.cjs
node --test tests/data-sync-cache.test.cjs
node --test tests/reservation.test.cjs
lua tests/common-api.lua
lua tests/reservation.lua
```

JavaScript側はNode.js 22以降、Lua側はLua 5.2を想定しています。
フロントのHTML変換・通信失敗時の非再送と、LuaのJSON/XML変換を検証します。
同期・キャッシュのテストでは、応答順序、読み取り失敗、SSE通知とタイマーを制御し、
世代管理、再取得、EPGキャッシュの無効化、タブ切替、接続停止・復旧を検証します。
予約のテストでは、対象データの送信、プリセット置換、チューナー選択、詳細取得の競合、
長時間・日またぎ予約と削除失敗の応答を検証します。
