# dsh-wallpaper · 本地壁纸插件

为 [DeepSeek Harness](https://github.com/deepseek-ai) Web GUI 提供**本地图片 / 视频壁纸**：上传自己的素材、手动切换、按时间自动轮换，全部在设置界面内完成，改动实时生效。

不依赖任何在线服务，素材只存在本机。

## ✨ 功能

- **图片与视频壁纸** — 图片支持 `.jpg` `.jpeg` `.png` `.webp` `.gif` `.bmp` `.avif`；视频支持 `.mp4` `.webm` `.ogv` `.mov` `.m4v`，自动静音循环播放
- **定时轮换** — 7 档间隔（30 秒 / 1 分钟 / 5 分钟 / 30 分钟 / 1 小时 / 3 小时 / 6 小时），可开可关；时钟在 Host 端，**关闭页面也会继续推进**
- **随机顺序** — 依次轮换或随机抽取
- **手动控制** — 点选任意素材、上一张 / 下一张
- **观感调节** — 壁纸清晰度、文字压暗、背景模糊、填充方式（铺满 / 完整 / 拉伸 / 平铺）
- **深色主题文字提亮** — 开着壁纸且处于深色主题时，自动把三档文字色提亮，保证对话正文可读
- **状态持久化** — 启用状态、间隔、当前素材等存入 `$DSH_HOME/wallpaper/index.json`

## 📦 安装

> 本插件**尚未发布到 npm**，当前请用下面的方式一或方式二安装。

### 方式一：`dsh plugin` 直接安装（推荐）

`dsh plugin` 可直接消费 GitHub 源码：

```bash
dsh plugin --profile web add github:whf-jx/dsh-wallpaper
```

安装后**重启一次** DSH（插件行按启动缓存发现），刷新页面即可。

### 方式二：手工挂载（适用于 `dsh plugin add` 不可用的环境）

```bash
# 1) 源码放到插件目录
git clone https://github.com/whf-jx/dsh-wallpaper.git ~/.dsh/plugins-src/dsh-wallpaper

# 2) 链接进 web profile 的 node_modules
#    Windows:
mklink /J "%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-wallpaper" "%USERPROFILE%\.dsh\plugins-src\dsh-wallpaper"
#    macOS / Linux:
ln -s ~/.dsh/plugins-src/dsh-wallpaper ~/.dsh/profiles/web/node_modules/dsh-wallpaper
```

3）在 `~/.dsh/profiles/web/cordis.patch.yml` 追加插入行：

```yaml
- insert:
    - id: wallpaper
      name: dsh-wallpaper
```

4）重启 DSH。

> **三处 `id` 必须一致**：patch 的 `id`、插入行的 `name`、客户端 bundle 的 `__ModuleLoader__.load({ id })`。
> 载体以 `/plugins/<entryName>/client.js` 提供 bundle，不一致会 404。
>
> 本包**零运行时依赖**，不需要 `pnpm install`；profile 的 `package.json` 也无需登记——
> 模块解析走 `node_modules` 目录本身。

## 🎛️ 使用

打开 **设置 → 本地壁纸**：

| 控件 | 说明 |
| --- | --- |
| 上传图片 / 视频 | 可多选；上传后立即出现在素材列表 |
| 启用壁纸 | 总开关，关闭后背景层整体卸载（含视频解码，不再占用 GPU） |
| 自动轮换 | 独立开关；关闭后固定显示当前素材，间隔按钮置灰但仍保留取值 |
| 随机顺序 | 开启后每次轮换随机抽取 |
| 轮换间隔 | 30 秒 → 6 小时共 7 档 |
| 壁纸清晰度 | 5–100%，越高图片越鲜明 |
| 文字压暗 | 0–90%，在壁纸之上压一层暗色，调高可让界面文字更清楚 |
| 背景模糊 | 0–60px，模糊背景降低图片细节对文字的干扰 |
| 填充方式 | 铺满 / 完整 / 拉伸 / 平铺（视频不支持平铺，自动按铺满处理） |

**深色主题建议**：壁纸清晰度 15–20%、文字压暗 60–70%、背景模糊 10–15px，兼顾氛围与可读性。

## 💾 数据位置

全部位于 `$DSH_HOME/wallpaper/`（默认 `~/.dsh/wallpaper/`）：

```
$DSH_HOME/wallpaper/
  index.json          # 唯一真相:启用状态、间隔、当前素材、素材清单
  images/             # 原始素材字节
  trace.log           # 可选,仅在 DSH_WALLPAPER_TRACE 环境变量存在时写入
  client-probe.json   # 可选,背景层自检快照(排障用)
```

删除素材时先改索引并落盘，字节清理是 best-effort，失败不影响一致性。

## 🔌 HTTP 路由

全部挂在 `/api/dsh-wallpaper` 下：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/state` | 完整状态 + 存储根路径 |
| GET | `/revision` | 轻量轮询：只取 revision 与状态，供页面感知后台轮换 |
| GET | `/image/<id>` | 返回素材字节；**视频支持 Range 请求** |
| POST | `/upload` | `{ images: [{ name, dataUrl }] }` |
| POST | `/remove` | `{ id }` |
| POST | `/select` | `{ id \| null }` |
| POST | `/step` | `{ delta: 1 \| -1 }` |
| POST | `/config` | `{ patch: { enabled?, rotate?, intervalMs?, shuffle?, opacity?, dim?, blur?, fit? } }` |
| POST | `/probe` | 客户端背景层自检上报（排障用，落盘 `client-probe.json`） |

## 🧩 设计要点

- **背景层是负 z-index 双层**：素材层 `z-index:-3` + 压暗层 `z-index:-2`。素材层承载不透明度、压暗层承载可读性，两个旋钮互不干扰；壁纸可见期间把 `html/body/#root` 的不透明底清空（卸载时精确还原）。
- **视频必须走 Range**：浏览器用分段请求流式播放 `<video>`，对忽略 Range 的源会直接拒绝播放或无法拖动进度。因此视频返回 `206 + Content-Range`、越界返回 `416`，并用流式读取而非整份载入内存。
- **`<video>` 是替换元素**：仅靠 `top/right/bottom/left` 不会拉伸，必须显式 `width/height:100%` 才能让 `object-fit` 生效。
- **计时器来自 `timer` 服务**：`ctx.setInterval` 并不存在，须 `inject: ['webServer', 'timer']` 后用 `ctx.timer.interval()`。漏注入会抛错，且异常发生在写盘之后、响应之前，表现为"保存生效但界面报 400"。
- **`kind` 字段贯穿两层**：Host 的 `publicState` 必须把 `kind`（`image`/`video`）发出，Client 的 `normalizeState` 必须把它映射进 items，否则渲染恒走图片分支。
- **主题自适应**：深色主题下把 `--dsw-alias-label-primary/secondary/tertiary` 提亮一档，仅在壁纸激活时生效，浅色主题不动。

## ⚠️ 已知限制

- 仅支持 **web** 形态的 DSH GUI（客户端通过 `shell.overlay` 与 `settings.section` 注入）。
- 视频壁纸会持续占用 GPU 解码资源；**建议码率压到 ~8 Mbps**（4 秒 4K 素材常见 50 Mbps 以上，作为常驻壁纸偏重）。
- 「平铺」对视频无效，自动降级为铺满。
- 无缩略图生成：视频在素材列表中以 `<video preload="metadata">` 预览（悬停播放）。

## 📄 License

MIT
