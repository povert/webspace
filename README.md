# 数据分析工作台

本地个人数据分析工作台，基于文件系统的本地 Web 工具。

## 功能特性

- **多工作空间管理**：创建、切换、重命名、删除独立工作空间
- **文件浏览器**：网格/列表视图切换，支持拖拽移动
- **脚本编辑与执行**：在线编辑 Python 脚本，一键执行并实时查看进度
- **报表管理**：自动生成报表，支持预览、重跑、关联查询
- **数据关联**：报表自动关联脚本和数据文件，支持反向查询

## 技术栈

- **后端**：Python Flask
- **前端**：HTML5 + Vanilla JavaScript
- **数据存储**：本地文件系统

## 安装与运行

```bash
# 创建虚拟环境（使用 uv）
uv venv

# 安装依赖
uv pip install -r requirements.txt

# 启动服务
python app.py
```

访问 http://localhost:5120

## 目录结构

```
workspace/
├── Default/           # 默认工作空间
│   ├── data/          # 数据文件
│   ├── scripts/       # Python 脚本
│   └── reports/       # 生成的报表
```

## 脚本协议

脚本通过 YAML 注解声明参数：

```python
"""
description: 数据分析报表
params:
  - name: --input
    label: 数据文件
    type: file
    default: data.csv
"""
```

输出 JSON 进度：

```python
print('{"progress": 0.5, "msg": "处理中..."}')
print('{"status": "success", "report": "report.html"}')
```
