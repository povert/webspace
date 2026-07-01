let state = {
    workspace: 'Default',
    category: 'scripts',
    currentPath: '',
    files: [],
    view: 'grid',
    workspaces: [],
    executionHistory: [],
    abortController: null,
};

document.addEventListener('DOMContentLoaded', function() {
    loadWorkspaces();
    loadFiles();
    document.querySelector('.console-header').addEventListener('click', function(e) {
        if (e.target.closest('.console-btn')) return;
        toggleConsole();
    });
});

async function loadWorkspaces() {
    try {
        var res = await fetch('/api/workspaces');
        state.workspaces = await res.json();
        renderWorkspaceSelector();
        updateBadges();
    } catch(e) { console.error('loadWorkspaces error:', e); }
}

function renderWorkspaceSelector() {
    var btn = document.getElementById('wsCurrentBtn');
    btn.textContent = '\u{1F4C1} ' + state.workspace;
    var dropdown = document.getElementById('wsDropdown');
    var html = state.workspaces.map(function(ws) {
        return '<div class="ws-item ' + (ws.name === state.workspace ? 'active' : '') +
            '" onclick="switchWorkspace(\'' + ws.name + '\')">\u{1F4C1} ' + ws.name + '</div>';
    }).join('');
    html += '<div class="ws-divider"></div>';
    html += '<div class="ws-item manage" onclick="closeDropdown();openWorkspaceManager()">\u2699\uFE0F 管理工作空间...</div>';
    dropdown.innerHTML = html;
    btn.onclick = function(e) {
        e.stopPropagation();
        dropdown.classList.toggle('show');
    };
}

document.addEventListener('click', function(e) {
    if (!e.target.closest('.workspace-selector')) closeDropdown();
});

function closeDropdown() {
    document.getElementById('wsDropdown').classList.remove('show');
}

async function switchWorkspace(name) {
    state.workspace = name;
    state.currentPath = '';
    closeDropdown();
    await loadFiles();
    await loadWorkspaces();
}

function switchCategory(cat) {
    state.category = cat;
    state.currentPath = '';
    document.querySelectorAll('.nav-item[data-category]').forEach(function(el) {
        el.classList.remove('active');
    });
    var target = document.querySelector('.nav-item[data-category="' + cat + '"]');
    if (target) target.classList.add('active');
    loadFiles();
}

async function loadFiles() {
    try {
        var url = '/api/file/list?workspace=' + encodeURIComponent(state.workspace) +
                  '&category=' + encodeURIComponent(state.category) +
                  '&path=' + encodeURIComponent(state.currentPath);
        var res = await fetch(url);
        state.files = await res.json();
        renderBreadcrumb();
        renderFiles();
        updateBadges();
    } catch(e) { console.error('loadFiles error:', e); }
}

function renderBreadcrumb() {
    var bc = document.getElementById('breadcrumb');
    var catLabel = { data: '数据', scripts: '脚本', reports: '报表' }[state.category];
    var html = '<span class="crumb" onclick="navigateTo(\'\')">' + catLabel + '</span>';
    if (state.currentPath) {
        var parts = state.currentPath.split('/').filter(Boolean);
        var path = '';
        for (var i = 0; i < parts.length; i++) {
            path += (path ? '/' : '') + parts[i];
            html += '<span class="crumb-sep">\u203A</span>';
            if (i === parts.length - 1) {
                html += '<span class="crumb current">' + escapeHtml(parts[i]) + '</span>';
            } else {
                var p = path;
                html += '<span class="crumb" onclick="navigateTo(\'' + escapeAttr(p) + '\')">' + escapeHtml(parts[i]) + '</span>';
            }
        }
    }
    bc.innerHTML = html;
}

function navigateTo(path) {
    state.currentPath = path;
    loadFiles();
}

function renderFiles() {
    var browser = document.getElementById('fileBrowser');
    var files = state.files;
    if (state.category === 'reports') {
        files = files.filter(function(f) {
            return !f.name.endsWith('.meta.json');
        });
    }
    if (files.length === 0) {
        browser.innerHTML = '<div class="empty-state"><div class="empty-icon">\u{1F4C2}</div><div>当前目录为空</div></div>';
        return;
    }
    if (state.view === 'grid') {
        browser.className = 'grid-view';
        browser.innerHTML = files.map(renderGridItem).join('');
    } else {
        browser.className = 'list-view';
        var html = '<div class="list-header"><span></span><span>文件名</span><span>大小</span><span>修改时间</span><span>操作</span></div>';
        html += files.map(renderListItem).join('');
        browser.innerHTML = html;
    }
    setupDragAndDrop();
}

function getFileIcon(f) {
    if (f.isDir) return '\u{1F4C1}';
    var ext = f.name.split('.').pop().toLowerCase();
    var icons = { csv: '\u{1F4CA}', py: '\u{1F40D}', html: '\u{1F310}', json: '\u{1F4CB}', log: '\u{1F4DD}', txt: '\u{1F4C4}' };
    return icons[ext] || '\u{1F4CE}';
}

function getClickAction(f) {
    if (f.isDir) return 'enterDir(\'' + escapeAttr(f.name) + '\')';
    var ext = f.name.split('.').pop().toLowerCase();
    if (state.category === 'reports' && ext === 'html') {
        return 'openReport(\'' + escapeAttr(f.path) + '\',\'' + ext + '\')';
    }
    return 'previewFile(\'' + escapeAttr(f.path) + '\')';
}

function renderGridItem(f) {
    var icon = getFileIcon(f);
    var actions = getActions(f);
    var clickAction = getClickAction(f);
    var linkedBtn = '';
    if (state.category === 'scripts' && !f.isDir && f.name.endsWith('.py')) {
        linkedBtn = '<button class="linked-btn" onclick="event.stopPropagation();showLinkedReports(\'script\',\'' + escapeAttr(f.path) + '\')" title="关联报表">\u{1F517}</button>';
    } else if (state.category === 'data' && !f.isDir) {
        linkedBtn = '<button class="linked-btn" onclick="event.stopPropagation();showLinkedReports(\'file\',\'data/' + escapeAttr(f.path) + '\')" title="关联报表">\u{1F517}</button>';
    } else if (state.category === 'reports' && !f.isDir && f.name.endsWith('.html')) {
        linkedBtn = '<button class="linked-btn" onclick="event.stopPropagation();showReportMeta(\'' + escapeAttr(f.path) + '\')" title="元数据">\u2139\uFE0F</button>';
    }
    return '<div class="file-card ' + (f.isDir ? 'is-dir' : '') + '" draggable="true" data-name="' + escapeAttr(f.name) +
        '" data-isdir="' + f.isDir + '" data-path="' + escapeAttr(f.path) +
        '" onclick="' + clickAction + '"' +
        (f.isDir ? ' ondblclick="enterDir(\'' + escapeAttr(f.name) + '\')"' : '') + '>' +
        linkedBtn +
        '<div class="file-icon">' + icon + '</div>' +
        '<div class="file-name" title="' + escapeAttr(f.name) + '">' + escapeHtml(f.name) + '</div>' +
        '<div class="file-meta">' + (f.isDir ? '文件夹' : (f.sizeStr + ' · ' + f.modified)) + '</div>' +
        '<div class="file-actions">' + actions + '</div>' +
        '</div>';
}

function renderListItem(f) {
    var icon = getFileIcon(f);
    var actions = getActions(f);
    var clickAction = getClickAction(f);
    var linkedBtn = '';
    if (state.category === 'scripts' && !f.isDir && f.name.endsWith('.py')) {
        linkedBtn = '<button class="linked-btn-inline" onclick="event.stopPropagation();showLinkedReports(\'script\',\'' + escapeAttr(f.path) + '\')" title="关联报表">\u{1F517}</button>';
    } else if (state.category === 'data' && !f.isDir) {
        linkedBtn = '<button class="linked-btn-inline" onclick="event.stopPropagation();showLinkedReports(\'file\',\'data/' + escapeAttr(f.path) + '\')" title="关联报表">\u{1F517}</button>';
    } else if (state.category === 'reports' && !f.isDir && f.name.endsWith('.html')) {
        linkedBtn = '<button class="linked-btn-inline" onclick="event.stopPropagation();showReportMeta(\'' + escapeAttr(f.path) + '\')" title="元数据">\u2139\uFE0F</button>';
    }
    return '<div class="list-row ' + (f.isDir ? 'is-dir' : '') + '" draggable="true" data-name="' + escapeAttr(f.name) +
        '" data-isdir="' + f.isDir + '" data-path="' + escapeAttr(f.path) +
        '" onclick="' + clickAction + '"' +
        (f.isDir ? ' ondblclick="enterDir(\'' + escapeAttr(f.name) + '\')"' : '') + '>' +
        '<span>' + icon + '</span>' +
        '<div class="file-name-cell"><span title="' + escapeAttr(f.name) + '">' + escapeHtml(f.name) + '</span></div>' +
        '<span style="color:var(--text-muted);font-size:12px">' + (f.isDir ? '\u2014' : f.sizeStr) + '</span>' +
        '<span style="color:var(--text-muted);font-size:12px">' + f.modified + '</span>' +
        '<div class="list-actions">' + linkedBtn + actions + '</div>' +
        '</div>';
}

function getActions(f) {
    var actions = [];
    var safeName = escapeAttr(f.name);
    var safePath = escapeAttr(f.path);
    if (f.isDir) {
        actions.push('<button class="action-btn" onclick="event.stopPropagation();enterDir(\'' + safeName + '\')" title="进入">\u{1F4C2}</button>');
        actions.push('<button class="action-btn" onclick="event.stopPropagation();renameItem(\'' + safeName + '\')" title="重命名">\u270F\uFE0F</button>');
        actions.push('<button class="action-btn danger" onclick="event.stopPropagation();deleteItem(\'' + safeName + '\')" title="删除">\u{1F5D1}</button>');
    } else {
        var ext = f.name.split('.').pop().toLowerCase();
        if (state.category === 'scripts' && ext === 'py') {
            actions.push('<button class="action-btn" onclick="event.stopPropagation();editFile(\'' + safePath + '\')" title="编辑">\u270F\uFE0F</button>');
            actions.push('<button class="action-btn" onclick="event.stopPropagation();executeScript(\'' + safePath + '\')" title="执行">\u25B6</button>');
        } else if (state.category === 'reports') {
            actions.push('<button class="action-btn" onclick="event.stopPropagation();openReport(\'' + safePath + '\',\'' + ext + '\')" title="打开">\u{1F441}</button>');
            actions.push('<button class="action-btn" onclick="event.stopPropagation();rerunReport(\'' + safePath + '\')" title="重跑">\u{1F504}</button>');
        } else {
            actions.push('<button class="action-btn" onclick="event.stopPropagation();previewFile(\'' + safePath + '\')" title="预览">\u{1F441}</button>');
        }
        actions.push('<button class="action-btn" onclick="event.stopPropagation();renameItem(\'' + safeName + '\')" title="重命名">\u{1F524}</button>');
        actions.push('<button class="action-btn danger" onclick="event.stopPropagation();deleteItem(\'' + safeName + '\')" title="删除">\u{1F5D1}</button>');
    }
    return actions.join('');
}

function enterDir(name) {
    state.currentPath = state.currentPath ? state.currentPath + '/' + name : name;
    loadFiles();
}

function setView(view) {
    state.view = view;
    document.querySelectorAll('.view-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.view === view);
    });
    renderFiles();
}

async function createFolder() {
    var name = prompt('请输入文件夹名称:');
    if (!name) return;
    var res = await fetch('/api/file/mkdir', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({workspace: state.workspace, category: state.category, path: state.currentPath, name: name})
    });
    var data = await res.json();
    if (data.error) { alert(data.error); return; }
    loadFiles();
}

async function deleteItem(name) {
    if (!confirm('确定要删除 "' + name + '" 吗？')) return;
    var filePath = state.currentPath ? state.currentPath + '/' + name : name;
    var res = await fetch('/api/file/delete', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({workspace: state.workspace, category: state.category, path: filePath})
    });
    var data = await res.json();
    if (data.error) { alert(data.error); return; }
    loadFiles();
}

async function renameItem(name) {
    var newName = prompt('请输入新名称:', name);
    if (!newName || newName === name) return;
    var filePath = state.currentPath ? state.currentPath + '/' + name : name;
    var res = await fetch('/api/file/rename', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({workspace: state.workspace, category: state.category, path: filePath, newName: newName})
    });
    var data = await res.json();
    if (data.error) { alert(data.error); return; }
    loadFiles();
}

async function previewFile(path) {
    var res = await fetch('/api/file/preview?workspace=' + encodeURIComponent(state.workspace) +
        '&category=' + encodeURIComponent(state.category) +
        '&path=' + encodeURIComponent(path));
    var data = await res.json();
    if (data.error) { alert(data.error); return; }
    var body = document.getElementById('modalBody');
    var content = data.content;
    if (data.truncated) content = '\u26A0 文件较大，已截断显示\n\n' + content;
    if (data.extension === '.csv') {
        content = renderCSVTable(data.content);
    } else if (data.extension === '.json') {
        try { content = JSON.stringify(JSON.parse(data.content), null, 2); } catch(e) {}
    }
    var sizeStr = data.size >= 1048576 ? (data.size/1048576).toFixed(1) + ' MB' : (data.size/1024).toFixed(1) + ' KB';
    body.innerHTML =
        '<div class="modal-info-bar"><span>' + escapeHtml(data.name) + ' · ' + sizeStr + '</span>' +
        '<span class="readonly-badge">\u{1F512} 只读</span></div>' +
        '<div class="preview-content">' + (data.extension === '.csv' ? content : escapeHtml(content)) + '</div>';
    document.getElementById('modalFooter').innerHTML = '';
    showModal(data.name);
}

function renderCSVTable(csv) {
    var lines = csv.trim().split('\n');
    if (!lines.length) return '';
    var headers = lines[0].split(',');
    var html = '<table><thead><tr>' + headers.map(function(h) { return '<th>' + escapeHtml(h) + '</th>'; }).join('') + '</tr></thead><tbody>';
    for (var i = 1; i < Math.min(lines.length, 101); i++) {
        html += '<tr>' + lines[i].split(',').map(function(c) { return '<td>' + escapeHtml(c) + '</td>'; }).join('') + '</tr>';
    }
    if (lines.length > 101) html += '<tr><td colspan="' + headers.length + '" style="text-align:center;color:var(--text-muted)">... 共 ' + (lines.length - 1) + ' 行</td></tr>';
    html += '</tbody></table>';
    return html;
}

async function editFile(path) {
    var res = await fetch('/api/file/preview?workspace=' + encodeURIComponent(state.workspace) + '&category=scripts&path=' + encodeURIComponent(path));
    var data = await res.json();
    if (data.error) { alert(data.error); return; }
    var body = document.getElementById('modalBody');
    body.innerHTML =
        '<div class="modal-info-bar"><span>' + escapeHtml(data.name) + '</span>' +
        '<span class="readonly-badge" style="background:rgba(63,185,80,0.1);color:var(--success)">\u270F\uFE0F 编辑</span></div>' +
        '<textarea class="code-editor" id="codeEditor">' + escapeHtml(data.content) + '</textarea>' +
        '<div class="save-status" id="saveStatus"></div>';
    showModal(data.name,
        '<button class="btn btn-secondary" onclick="closeModal()">取消</button>' +
        '<button class="btn btn-primary" id="saveBtn">\u{1F4BE} 保存</button>');
    document.getElementById('saveBtn').addEventListener('click', function() { saveFile(path); });
}

async function saveFile(path) {
    var content = document.getElementById('codeEditor').value;
    var status = document.getElementById('saveStatus');
    var res = await fetch('/api/file/save', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({workspace: state.workspace, category: 'scripts', path: path, content: content})
    });
    var data = await res.json();
    if (data.ok) { status.textContent = '\u2705 已保存'; status.style.color = 'var(--success)'; setTimeout(function() { status.textContent = ''; }, 2000); }
    else { status.textContent = '\u274C 保存失败: ' + (data.error || ''); status.style.color = 'var(--danger)'; }
}

async function executeScript(path) {
    var metaRes = await fetch('/api/script/meta?workspace=' + encodeURIComponent(state.workspace) + '&path=' + encodeURIComponent(path));
    var meta = await metaRes.json();
    if (meta.error) { alert(meta.error); return; }
    if (!meta.params || meta.params.length === 0) { startExecution(path, {}); return; }
    var body = document.getElementById('modalBody');
    var paramsHtml = '';
    if (meta.description) paramsHtml += '<div class="param-desc">' + escapeHtml(meta.description) + '</div>';
    for (var i = 0; i < meta.params.length; i++) {
        var p = meta.params[i];
        paramsHtml += '<div class="form-group"><label>' + escapeHtml(p.label || p.name) + '</label>';
        if (p.type === 'choice' && p.choices) {
            paramsHtml += '<select class="form-input" data-param="' + escapeAttr(p.name) + '">';
            for (var j = 0; j < p.choices.length; j++) paramsHtml += '<option value="' + escapeAttr(p.choices[j]) + '">' + escapeHtml(p.choices[j]) + '</option>';
            paramsHtml += '</select>';
        } else if (p.type === 'file') {
            var fileRes = await fetch('/api/file/list?workspace=' + encodeURIComponent(state.workspace) + '&category=data&path=' + encodeURIComponent(p.path || ''));
            var files = await fileRes.json();
            var fileOptions = [];
            for (var k = 0; k < files.length; k++) { if (!files[k].isDir) fileOptions.push({v: files[k].path, n: files[k].name}); }
            paramsHtml += '<div class="custom-select-wrap"><input class="form-input custom-select-input" data-param="' + escapeAttr(p.name) + '" data-param-type="file" data-options=\'' + JSON.stringify(fileOptions) + '\' value="' + escapeAttr(p.default || '') + '" placeholder="选择或输入文件路径" autocomplete="off"><div class="custom-select-dropdown"></div></div>';
        } else if (p.type === 'dir') {
            var dirRes = await fetch('/api/file/list?workspace=' + encodeURIComponent(state.workspace) + '&category=data&path=' + encodeURIComponent(p.path || ''));
            var dirs = await dirRes.json();
            var dirOptions = [];
            for (var d = 0; d < dirs.length; d++) { if (dirs[d].isDir) dirOptions.push({v: dirs[d].path, n: dirs[d].name + '/'}); }
            paramsHtml += '<div class="custom-select-wrap"><input class="form-input custom-select-input" data-param="' + escapeAttr(p.name) + '" data-param-type="dir" data-options=\'' + JSON.stringify(dirOptions) + '\' value="" placeholder="选择或输入目录路径" autocomplete="off"><div class="custom-select-dropdown"></div></div>';
        } else {
            paramsHtml += '<input class="form-input" type="text" data-param="' + escapeAttr(p.name) + '" value="' + escapeAttr(p.default || '') + '" placeholder="' + escapeAttr(p.placeholder || '') + '">';
        }
        paramsHtml += '</div>';
    }
    body.innerHTML = paramsHtml || '<div class="param-desc">脚本无参数</div>';
    showModal('执行: ' + path.split('/').pop(),
        '<button class="btn btn-secondary" onclick="closeModal()">取消</button>' +
        '<button class="btn btn-primary" id="runBtn">\u25B6 开始运行</button>');
    document.getElementById('runBtn').addEventListener('click', function() {
        var params = {};
        document.querySelectorAll('#modalBody [data-param]').forEach(function(el) {
            var val = el.value;
            if (val) {
                var paramType = el.dataset.paramType;
                if (paramType === 'file' || paramType === 'dir') {
                    if (!val.startsWith('data/') && !val.startsWith('scripts/')) val = 'data/' + val;
                }
                params[el.dataset.param] = val;
            }
        });
        closeModal();
        startExecution(path, params);
    });
}

function startExecution(path, params) {
    if (state.abortController) state.abortController.abort();
    state.abortController = new AbortController();
    var panel = document.getElementById('console-panel');
    panel.classList.remove('collapsed');
    document.getElementById('stopBtn').disabled = false;
    document.getElementById('consoleProgress').style.display = 'flex';
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('progressText').textContent = '0%';
    document.getElementById('consoleLog').innerHTML = '';
    appendLog('\u25B6 开始执行: scripts/' + path.split('/').pop(), '');

    fetch('/api/script/execute', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({workspace: state.workspace, path: path, params: params}),
        signal: state.abortController.signal
    }).then(function(response) {
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        function read() {
            return reader.read().then(function(result) {
                if (result.done) { document.getElementById('stopBtn').disabled = true; state.abortController = null; return; }
                buffer += decoder.decode(result.value, {stream: true});
                var parts = buffer.split('\n');
                buffer = parts.pop();
                for (var i = 0; i < parts.length; i++) {
                    var line = parts[i].trim();
                    if (!line.startsWith('data: ')) continue;
                    var payload = line.slice(6);
                    if (payload === '[DONE]') { document.getElementById('stopBtn').disabled = true; state.abortController = null; updateHistory(path, 'success'); loadFiles(); return; }
                    try {
                        var msg = JSON.parse(payload);
                        if (msg.msg) appendLog(msg.msg, msg.status || '');
                        if (msg.progress !== undefined) { var pct = Math.round(msg.progress * 100); document.getElementById('progressFill').style.width = pct + '%'; document.getElementById('progressText').textContent = pct + '%'; }
                        if (msg.status === 'success') updateHistory(path, 'success');
                        if (msg.status === 'error') updateHistory(path, 'error');
                    } catch(e) {}
                }
                return read();
            });
        }
        return read();
    }).catch(function(err) {
        if (err.name === 'AbortError') appendLog('\u23F9 已停止执行', 'error');
        else appendLog('\u274C 连接错误: ' + err.message, 'error');
        document.getElementById('stopBtn').disabled = true;
        state.abortController = null;
    });
}

function appendLog(msg, status) {
    if (!msg) return;
    var log = document.getElementById('consoleLog');
    var line = document.createElement('div');
    line.className = 'log-line' + (status === 'error' ? ' log-error' : '') + (status === 'success' ? ' log-success' : '');
    line.textContent = '[' + new Date().toLocaleTimeString('zh-CN', {hour12: false}) + '] ' + msg;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
}

function updateHistory(path, status) {
    var name = path.split('/').pop();
    var time = new Date().toLocaleTimeString('zh-CN', {hour12: false, hour: '2-digit', minute: '2-digit'});
    state.executionHistory.unshift({name: name, time: time, icon: status === 'success' ? '\u2705' : '\u274C', status: status});
    if (state.executionHistory.length > 10) state.executionHistory.pop();
    renderHistory();
}

function renderHistory() {
    var el = document.getElementById('consoleHistory');
    if (state.executionHistory.length === 0) { el.innerHTML = ''; return; }
    el.innerHTML = '执行历史: ' + state.executionHistory.map(function(h) {
        return '<span style="margin-right:8px">' + h.icon + ' ' + h.name + ' ' + h.time + '</span>';
    }).join('');
}

function stopExecution() {
    if (state.abortController) { state.abortController.abort(); state.abortController = null; }
    fetch('/api/script/stop', {method: 'POST'});
    document.getElementById('stopBtn').disabled = true;
    appendLog('\u23F9 已停止执行', 'error');
}

function clearConsole() {
    document.getElementById('consoleLog').innerHTML = '';
    document.getElementById('consoleHistory').innerHTML = '';
    state.executionHistory = [];
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('progressText').textContent = '0%';
    document.getElementById('consoleProgress').style.display = 'none';
}

function toggleConsole() {
    var panel = document.getElementById('console-panel');
    var btn = panel.querySelector('.console-actions .console-btn:last-child');
    panel.classList.toggle('collapsed');
    btn.textContent = panel.classList.contains('collapsed') ? '\u25B2 展开' : '\u25BC 收起';
}

function openReport(path, ext) {
    window.open('/api/report/view?workspace=' + encodeURIComponent(state.workspace) + '&path=' + encodeURIComponent(path), '_blank');
}

async function rerunReport(path) {
    var metaRes = await fetch('/api/report/meta?workspace=' + encodeURIComponent(state.workspace) + '&path=' + encodeURIComponent(path));
    var meta = await metaRes.json();
    if (meta && meta.script) { switchCategory('scripts'); setTimeout(function() { executeScript(meta.script); }, 300); }
    else alert('未找到该报表的脚本关联信息，无法重跑');
}

async function showLinkedReports(queryType, query) {
    var res = await fetch('/api/linked-reports?workspace=' + encodeURIComponent(state.workspace) + '&type=' + encodeURIComponent(queryType) + '&query=' + encodeURIComponent(query));
    var reports = await res.json();
    var body = document.getElementById('modalBody');
    if (reports.length === 0) {
        body.innerHTML = '<div class="empty-state" style="padding:30px"><div class="empty-icon">\u{1F4CB}</div><div>暂无关联报表</div></div>';
    } else {
        var html = '<div class="linked-list">';
        reports.forEach(function(r) {
            var detailText = '';
            if (queryType === 'script') {
                detailText = '\u{1F4CA} 数据: ' + (r.data_files || []).join(', ');
            } else {
                detailText = '\u{1F40D} 脚本: scripts/' + r.script;
            }
            html += '<div class="linked-item" onclick="event.stopPropagation();window.open(\'/api/report/view?workspace=' + encodeURIComponent(state.workspace) + '&path=' + encodeURIComponent(r.path) + '\',\'_blank\')">' +
                '<div class="linked-item-main">' + escapeHtml(r.path) + '</div>' +
                '<div class="linked-item-sub"><span class="linked-time">' + escapeHtml(r.timestamp) + '</span> · ' + escapeHtml(detailText) + '</div>' +
                '</div>';
        });
        html += '</div>';
        body.innerHTML = html;
    }
    var label = query.split('/').pop();
    showModal('\u{1F517} 关联报表: ' + label);
    document.getElementById('modalFooter').innerHTML = '';
}

async function showReportMeta(path) {
    var res = await fetch('/api/report/meta?workspace=' + encodeURIComponent(state.workspace) + '&path=' + encodeURIComponent(path));
    var meta = await res.json();
    var body = document.getElementById('modalBody');
    if (!meta || Object.keys(meta).length === 0) {
        body.innerHTML = '<div class="empty-state" style="padding:30px"><div>暂无元数据</div></div>';
    } else {
        var html = '<div class="meta-panel">';
        html += '<div class="meta-section"><div class="meta-label">脚本</div><div class="meta-value code-block">' + escapeHtml(meta.script || '') + '</div></div>';
        html += '<div class="meta-section"><div class="meta-label">时间</div><div class="meta-value">' + escapeHtml(meta.timestamp || '') + '</div></div>';
        if (meta.cmd) html += '<div class="meta-section"><div class="meta-label">命令</div><div class="meta-value code-block">' + escapeHtml(meta.cmd) + '</div></div>';
        if (meta.params && Object.keys(meta.params).length > 0) {
            html += '<div class="meta-section"><div class="meta-label">参数</div><div class="meta-value">';
            for (var k in meta.params) html += '<div>' + escapeHtml(k) + ' = ' + escapeHtml(meta.params[k]) + '</div>';
            html += '</div></div>';
        }
        if (meta.files && meta.files.length > 0) {
            html += '<div class="meta-section"><div class="meta-label">涉及文件</div><div class="meta-value">';
            meta.files.forEach(function(f) { html += '<div class="meta-file">\u{1F4C4} ' + escapeHtml(f) + '</div>'; });
            html += '</div></div>';
        }
        html += '</div>';
        body.innerHTML = html;
    }
    showModal('\u2139\uFE0F ' + path.split('/').pop());
    document.getElementById('modalFooter').innerHTML = '';
}

function setupDragAndDrop() {
    document.querySelectorAll('.file-card[draggable], .list-row[draggable]').forEach(function(item) {
        item.addEventListener('dragstart', function(e) {
            e.dataTransfer.setData('text/plain', item.dataset.name);
            e.dataTransfer.effectAllowed = 'move';
            item.classList.add('dragging');
        });
        item.addEventListener('dragend', function() {
            item.classList.remove('dragging');
            document.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
        });
    });
    document.querySelectorAll('.file-card.is-dir[draggable], .list-row.is-dir[draggable]').forEach(function(dir) {
        dir.addEventListener('dragover', function(e) { e.preventDefault(); dir.classList.add('drag-over'); });
        dir.addEventListener('dragleave', function() { dir.classList.remove('drag-over'); });
        dir.addEventListener('drop', function(e) {
            e.preventDefault(); e.stopPropagation();
            dir.classList.remove('drag-over');
            moveFile(e.dataTransfer.getData('text/plain'), state.currentPath ? state.currentPath + '/' + dir.dataset.name : dir.dataset.name);
        });
    });
    document.querySelectorAll('.crumb:not(.current)').forEach(function(crumb) {
        crumb.addEventListener('dragover', function(e) { e.preventDefault(); crumb.classList.add('drag-over'); });
        crumb.addEventListener('dragleave', function() { crumb.classList.remove('drag-over'); });
        crumb.addEventListener('drop', function(e) { e.preventDefault(); crumb.classList.remove('drag-over'); moveFile(e.dataTransfer.getData('text/plain'), ''); });
    });
}

async function moveFile(fileName, destPath) {
    var srcPath = state.currentPath ? state.currentPath + '/' + fileName : fileName;
    await fetch('/api/file/move', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({workspace: state.workspace, category: state.category, path: srcPath, destCategory: state.category, destPath: destPath})
    });
    loadFiles();
}

async function updateBadges() {
    for (var i = 0; i < ['data', 'scripts', 'reports'].length; i++) {
        var cat = ['data', 'scripts', 'reports'][i];
        var res = await fetch('/api/file/list?workspace=' + encodeURIComponent(state.workspace) + '&category=' + cat + '&path=');
        var files = await res.json();
        var badge = document.getElementById('badge-' + cat);
        if (badge) badge.textContent = files.length;
    }
}

function refreshAll() { loadFiles(); }

function showModal(title, footer) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalOverlay').classList.add('show');
    document.getElementById('modalFooter').innerHTML = footer || '';
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('show');
    document.getElementById('modalFooter').innerHTML = '';
}

document.getElementById('modalOverlay').addEventListener('click', function(e) { if (e.target === this) closeModal(); });
document.querySelector('.modal-close').addEventListener('click', closeModal);

function openWorkspaceManager() {
    var body = document.getElementById('modalBody');
    var html = state.workspaces.map(function(ws) {
        return '<div class="ws-manager-item"><div><span class="ws-name">\u{1F4C1} ' + escapeHtml(ws.name) + '</span>' +
            '<span class="ws-stats">数据:' + ws.dataCount + ' 脚本:' + ws.scriptsCount + ' 报表:' + ws.reportsCount + '</span></div>' +
            '<div class="ws-manager-actions"><button class="action-btn" onclick="renameWorkspace(\'' + escapeAttr(ws.name) + '\')">\u270F\uFE0F</button>' +
            '<button class="action-btn danger" onclick="deleteWorkspace(\'' + escapeAttr(ws.name) + '\')">\u{1F5D1}</button></div></div>';
    }).join('');
    body.innerHTML = html || '<div class="empty-state">暂无工作空间</div>';
    showModal('工作空间管理');
    document.getElementById('modalFooter').innerHTML = '<button class="btn btn-primary" id="newWsBtn">+ 新建工作空间</button>';
    document.getElementById('newWsBtn').addEventListener('click', createWorkspace);
}

async function createWorkspace() {
    var name = prompt('请输入工作空间名称:');
    if (!name) return;
    var res = await fetch('/api/workspaces', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: name})});
    var data = await res.json();
    if (data.error) { alert(data.error); return; }
    state.workspace = name; state.currentPath = '';
    await loadWorkspaces(); await loadFiles(); openWorkspaceManager();
}

async function renameWorkspace(name) {
    var newName = prompt('请输入新名称:', name);
    if (!newName || newName === name) return;
    var res = await fetch('/api/workspaces/' + encodeURIComponent(name), {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: newName})});
    var data = await res.json();
    if (data.error) { alert(data.error); return; }
    if (state.workspace === name) state.workspace = newName;
    await loadWorkspaces(); await loadFiles(); openWorkspaceManager();
}

async function deleteWorkspace(name) {
    if (!confirm('确定要删除工作空间 "' + name + '" 吗？所有数据将被永久删除！')) return;
    var res = await fetch('/api/workspaces/' + encodeURIComponent(name), {method: 'DELETE'});
    var data = await res.json();
    if (data.error) { alert(data.error); return; }
    if (state.workspace === name) state.workspace = 'Default';
    await loadWorkspaces(); await loadFiles(); openWorkspaceManager();
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeModal(); });

// Custom select
document.addEventListener('click', function(e) {
    var wrap = e.target.closest('.custom-select-wrap');
    document.querySelectorAll('.custom-select-wrap.open').forEach(function(w) { if (w !== wrap) w.classList.remove('open'); });
});

document.addEventListener('focus', function(e) {
    if (!e.target.classList.contains('custom-select-input')) return;
    var wrap = e.target.closest('.custom-select-wrap');
    if (!wrap) return;
    renderCustomDropdown(wrap, false);
    wrap.classList.add('open');
}, true);

document.addEventListener('click', function(e) {
    var input = e.target.closest('.custom-select-input');
    if (!input) return;
    var wrap = input.closest('.custom-select-wrap');
    if (!wrap) return;
    renderCustomDropdown(wrap, false);
    wrap.classList.toggle('open');
});

document.addEventListener('input', function(e) {
    if (!e.target.classList.contains('custom-select-input')) return;
    var wrap = e.target.closest('.custom-select-wrap');
    if (!wrap) return;
    renderCustomDropdown(wrap, true);
    wrap.classList.add('open');
});

document.addEventListener('mousedown', function(e) {
    var item = e.target.closest('.custom-select-option');
    if (!item) return;
    e.preventDefault();
    var wrap = item.closest('.custom-select-wrap');
    var input = wrap.querySelector('.custom-select-input');
    input.value = item.dataset.value;
    wrap.classList.remove('open');
});

function renderCustomDropdown(wrap, filter) {
    var input = wrap.querySelector('.custom-select-input');
    var dropdown = wrap.querySelector('.custom-select-dropdown');
    var options;
    try { options = JSON.parse(input.dataset.options); } catch(ex) { options = []; }
    var val = input.value.toLowerCase();
    var filtered = filter && val ? options.filter(function(o) { return o.v.toLowerCase().indexOf(val) !== -1 || o.n.toLowerCase().indexOf(val) !== -1; }) : options;
    if (filtered.length === 0) { dropdown.innerHTML = '<div class="custom-select-empty">无匹配项</div>'; return; }
    dropdown.innerHTML = filtered.map(function(o) {
        return '<div class="custom-select-option" data-value="' + escapeAttr(o.v) + '"><span class="option-name">' + escapeHtml(o.n) + '</span><span class="option-path">' + escapeHtml(o.v) + '</span></div>';
    }).join('');
}

// AI Terminal
var aiTerminal = null;
var aiTerminalWs = null;
var aiTerminalFit = null;
var aiTerminalOpen = false;

function toggleAiTerminal() {
    var panel = document.getElementById('ai-terminal-panel');
    aiTerminalOpen = !aiTerminalOpen;
    if (aiTerminalOpen) {
        panel.classList.remove('hidden');
        document.getElementById('aiTerminalBtn').classList.add('active');
        if (!aiTerminal) initAiTerminal();
        setTimeout(function() { aiTerminalFit && aiTerminalFit.fit(); }, 100);
    } else {
        panel.classList.add('hidden');
        document.getElementById('aiTerminalBtn').classList.remove('active');
    }
}

function initAiTerminal() {
    var container = document.getElementById('ai-terminal-container');
    if (!container) return;
    var Term = window.Terminal;
    var FitAddon = window.FitAddon;
    var WebLinksAddon = window.WebLinksAddon;

    if (!Term) {
        console.error('xterm.js Terminal not loaded');
        return;
    }

    aiTerminal = new Term({
        theme: {
            background: '#0d1117',
            foreground: '#e6edf3',
            cursor: '#58a6ff',
            cursorAccent: '#0d1117',
            selectionBackground: '#264f78',
            black: '#0d1117',
            red: '#f85149',
            green: '#3fb950',
            yellow: '#d29922',
            blue: '#58a6ff',
            magenta: '#bc8cff',
            cyan: '#39c5cf',
            white: '#e6edf3',
            brightBlack: '#6e7681',
            brightRed: '#f85149',
            brightGreen: '#3fb950',
            brightYellow: '#d29922',
            brightBlue: '#58a6ff',
            brightMagenta: '#bc8cff',
            brightCyan: '#56d4dd',
            brightWhite: '#f0f6fc'
        },
        fontFamily: '"Cascadia Code", "Fira Code", "SF Mono", monospace',
        fontSize: 13,
        cursorBlink: true,
        allowProposedApi: true,
    });

    aiTerminalFit = new FitAddon.FitAddon();
    aiTerminal.loadAddon(aiTerminalFit);
    aiTerminal.loadAddon(new WebLinksAddon.WebLinksAddon());

    aiTerminal.open(container);

    setTimeout(function() {
        if (aiTerminalFit) {
            aiTerminalFit.fit();
            var size = aiTerminalFit.proposeDimensions();
            if (size) {
                console.log('Terminal size:', size.cols, 'x', size.rows);
            }
        }
    }, 200);

    var savedCmd = localStorage.getItem('ai_cli_command') || '';
    document.getElementById('aiCommandInput').value = savedCmd;

    aiTerminal.onData(function(data) {
        if (aiTerminalWs && aiTerminalWs.readyState === 1) {
            aiTerminalWs.send(JSON.stringify({type: 'input', data: data}));
        }
    });

    aiTerminal.onResize(function(size) {
        if (aiTerminalWs && aiTerminalWs.readyState === 1) {
            aiTerminalWs.send(JSON.stringify({type: 'resize', rows: size.rows, cols: size.cols}));
        }
    });

    connectAiTerminal();

    window.addEventListener('resize', function() {
        if (aiTerminalOpen && aiTerminalFit) aiTerminalFit.fit();
    });
}

function connectAiTerminal() {
    if (aiTerminalWs) {
        try { aiTerminalWs.close(); } catch(e) {}
    }

    setAiStatus('connecting');
    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsUrl = protocol + '//' + location.hostname + ':5121';
    aiTerminalWs = new WebSocket(wsUrl);

    var savedCmd = localStorage.getItem('ai_cli_command') || '';
    var command = savedCmd || 'claude';

    aiTerminalWs.onopen = function() {
        aiTerminalWs.send(JSON.stringify({
            workspace: state.workspace,
            command: command
        }));
        setAiStatus('connected');
        if (aiTerminal) {
            aiTerminal.focus();
            setTimeout(function() {
                if (aiTerminalFit) {
                    aiTerminalFit.fit();
                    var size = aiTerminalFit.proposeDimensions();
                    if (size && aiTerminalWs.readyState === 1) {
                        aiTerminalWs.send(JSON.stringify({type: 'resize', rows: size.rows, cols: size.cols}));
                    }
                }
            }, 300);
        }
    };

    aiTerminalWs.onmessage = function(evt) {
        if (aiTerminal) {
            var data = evt.data;
            try {
                var msg = JSON.parse(data);
                if (msg.type === 'exit') {
                    setAiStatus('disconnected');
                    aiTerminal.writeln('\r\n\x1b[33m[会话已结束]\x1b[0m');
                    return;
                }
                if (msg.type === 'error') {
                    aiTerminal.writeln('\r\n\x1b[31m[错误: ' + msg.msg + ']\x1b[0m');
                    setAiStatus('error');
                    return;
                }
            } catch(e) {}
            aiTerminal.write(data);
        }
    };

    aiTerminalWs.onclose = function() {
        setAiStatus('disconnected');
    };

    aiTerminalWs.onerror = function() {
        setAiStatus('error');
    };
}

function setAiStatus(status) {
    var dot = document.getElementById('aiStatusDot');
    var text = document.getElementById('aiStatusText');
    dot.className = 'ai-status-dot';
    var labels = {connected: '已连接', connecting: '连接中...', disconnected: '已断开', error: '连接失败'};
    text.textContent = labels[status] || status;
    if (status === 'connected') dot.classList.add('connected');
    else if (status === 'connecting') dot.classList.add('connecting');
    else if (status === 'error') dot.classList.add('error');
}

function newAiTerminalSession() {
    if (aiTerminal) aiTerminal.clear();
    connectAiTerminal();
}

function toggleAiSettings() {
    var settings = document.getElementById('aiSettings');
    settings.classList.toggle('hidden');
}

function saveAiSettings() {
    var cmd = document.getElementById('aiCommandInput').value.trim();
    localStorage.setItem('ai_cli_command', cmd);
    toggleAiSettings();
}

// Alias for HTML onclick
function newAiSession() { newAiTerminalSession(); }
