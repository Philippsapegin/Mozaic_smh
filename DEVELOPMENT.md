# Разработка Мозаики

Инструкция для пользователей — в [README.md](README.md).

## Запуск и сборка

Нужны Node.js, Rust для `x86_64-pc-windows-msvc`, Microsoft C++ Build Tools с Windows SDK и WebView2 Runtime.

```powershell
npm ci
npm run desktop:dev
npm run desktop:build
```

Для работы в браузере: `npm run dev`. Локальные модели лежат в `public/models/`; WASM копируется из npm перед запуском. YOLO выполняется в отдельном Worker. В WebView2 используется один поток WASM, чтобы избежать зависания вложенных Worker. Сервер распознавания не используется.

## Проверки

```powershell
npm test
npm run test:regressions
node tests/bundle-fonts.mjs
npm run test:updates
node tests/shortcut.mjs
node tests/face-contour.mjs "C:\path\to\portrait.jpg"
node tests/desktop.mjs "C:\path\to\portrait.jpg"
node tests/release-signature.mjs
node tests/desktop-updates.mjs
```

Проверки интерфейса используют установленный Edge. Для контуров и EXE нужен контрольный портрет MediaPipe 820 × 1024. Проверка подписи требует собранный установщик; она также проверяет отклонение изменённого файла.

После публикации можно проверить уведомление в предыдущей версии: `node tests/desktop-updates.mjs release/Mozaic-1.0.3.exe`. Проверка открывает отдельную копию с временным профилем и не устанавливает обновление.

## Подписанные обновления и публикация

Используется [официальный Tauri Updater](https://v2.tauri.app/plugin/updater/). Приложение проверяет последний GitHub Release при запуске, затем раз в четыре часа и при возвращении в окно после часа отсутствия. Без интернета проверка молча пропускается. Установка начинается по нажатию пользователя; перед перезапуском можно сохранить открытое изображение.

Приватный ключ находится вне проекта: `%USERPROFILE%\.tauri\mozaic-update.key`. Храните его резервную копию: следующие версии должны подписываться тем же ключом. В `tauri.conf.json` находится только публичный ключ. `scripts/desktop.mjs` подставляет приватный ключ при сборке. На другом компьютере можно задать `TAURI_SIGNING_PRIVATE_KEY` и `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

Для нового релиза увеличьте версию в `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` и `src-tauri/tauri.conf.json`, соберите приложение, выполните проверки и отправьте коммит в GitHub. Затем:

```powershell
npm run release
```

Сборка создаёт `release/latest.json`, подписанный установщик, `release/Mozaic-Windows.zip`, ярлык и установщик в корне проекта. Публикация сначала загружает все файлы в черновик GitHub Release и лишь затем делает его доступным. Используется `GITHUB_TOKEN`/`GH_TOKEN` либо сохранённая авторизация Git. Опубликованные версии не перезаписываются.

Архив содержит ярлык и установщик в корне, вспомогательные файлы — в `app/`. Ярлык работает после переноса папки. Из установленной и переносимой копий выбирается более новая, чтобы после обновления открывалась актуальная установленная версия.
