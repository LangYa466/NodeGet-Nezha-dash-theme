# NodeGet-Nezha-dash-theme

Fork自 [telly3e/nezha-dash-v1](https://github.com/telly3e/nezha-dash-v1-komari) 

## 开发

```bash
npm i
npm run dev
```

# 部署
跟着這個教程 記得改一下fork的url
https://www.nodeseek.com/post-713622-1

# 环境变量

> 环境变量是 **build 时** 注入的 改完之后必须重新部署一次才会生效 在面板里光改不重新跑 build 是没用的

```
SITE_NAME=狼牙的探针
SITE_LOGO=https://example.com/logo.png
SITE_FOOTER=Powered by NodeGet
SITE_1=name="master-1",backend_url="wss://m1.example.com",token="abc123"
SITE_2=name="master-2",backend_url="wss://m2.example.com",token="xyz789" 
```

前三个对应 `site_name` / `site_logo` / `footer` 不写就用默认值

`SITE_n` 是主控 值用 `key="value"` 拿逗号串起来 支持 `name` / `backend_url` / `token` 三个字段 值里要塞引号或反斜杠的话用 `\"` 和 `\\` 转义

从 `SITE_1` 开始连续往上数 中间断了就停 所以加新主控接着 `SITE_3` `SITE_4` 就行

一个 `SITE_n` 都没设的话脚本啥也不干 直接用仓库里那份 `config.json` 本地 `npm run dev` 走的是 vite 直接起 也不会触发这个脚本

可以只有一个 `SITE` 不强制 `SITE_2` `SITE_3` 之类的

# 截图
<img width="1194" height="1668" alt="image" src="https://github.com/user-attachments/assets/df2cddd0-8ddd-452b-b0ec-37c2deb267b8" />
<img width="1194" height="2358" alt="image" src="https://github.com/user-attachments/assets/43b853bb-8b17-4b66-a34c-33bb4a71f045" />
<img width="1194" height="1150" alt="image" src="https://github.com/user-attachments/assets/785afcc4-0fe4-4e92-a81f-a08cd98ad241" />
<img width="1194" height="1324" alt="image" src="https://github.com/user-attachments/assets/efd5c123-a708-4bf1-98f0-24159f60222b" />

