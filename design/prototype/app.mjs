import { ENVIRONMENTS, defaultConfig, normalizeMachine, normalizeUrl, validateConfig, validateRule } from './model.mjs';

const STORAGE_KEY = 'nlab-easy-whistle-desktop-prototype-v2';
const element = (id) => document.getElementById(id);
const ADD_MACHINE = '';
let config = defaultConfig();
let editedRule = null;
let draftMachine = '';
let machineTarget = null;
let pendingImport = null;
let noticeTimer;

function notice(message, error = false) {
  clearTimeout(noticeTimer);
  element('notice-text').textContent = message;
  element('notice-text').className = `rounded-lg border bg-base-100 px-5 py-3 text-sm shadow-sm ${error ? 'border-error/30 text-error' : 'border-base-300 text-base-content'}`;
  element('notice').classList.remove('hidden');
  noticeTimer = setTimeout(() => element('notice').classList.add('hidden'), error ? 6000 : 3500);
}

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) config = validateConfig(JSON.parse(saved));
} catch {
  notice('本地配置无法读取，已显示默认规则。', true);
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    return true;
  } catch {
    notice('浏览器无法保存配置，请导出 YAML 备份。', true);
    return false;
  }
}

function inputError(id, message = '') {
  element(id).textContent = message;
  element(id).classList.toggle('hidden', !message);
}

function append(parent, tag, className = '', text = '') {
  const child = document.createElement(tag);
  child.className = className;
  child.textContent = text;
  parent.append(child);
  return child;
}

function populateMachines(select, selected) {
  select.replaceChildren(...config.machines.map((machine) => new Option(machine, machine)), new Option('＋ 新增测试机…', ADD_MACHINE));
  select.value = selected;
}

function openMachine(target) {
  machineTarget = target;
  element('machine-form').reset();
  inputError('machine-error');
  element('machine-dialog').showModal();
}

function openRule(index = null) {
  editedRule = index;
  const rule = index === null ? { enabled: true, patterns: [], environment: 'test', machine: config.machines[0] } : config.rules[index];
  draftMachine = rule.machine;
  element('rule-title').textContent = index === null ? '新增规则' : '编辑规则';
  element('rule-patterns').value = rule.patterns.join('\n');
  element('rule-environment').value = rule.environment;
  populateMachines(element('rule-machine'), rule.machine);
  element('rule-enabled').checked = rule.enabled;
  inputError('rule-error');
  element('rule-dialog').showModal();
}

function render() {
  element('connection-url').textContent = config.whistle.url;
  element('apply-button').disabled = !config.rules.length;
  const table = element('rules-table');
  table.replaceChildren();
  config.rules.forEach((rule, index) => {
    const row = append(table, 'tr', 'border-base-300/70');
    const enabledCell = append(row, 'td', 'py-4 pl-5 align-middle');
    const enabled = append(enabledCell, 'input', 'toggle toggle-sm toggle-success');
    enabled.type = 'checkbox';
    enabled.checked = rule.enabled;
    enabled.setAttribute('aria-label', `启用规则 ${index + 1}：${rule.patterns[0]}`);
    enabled.addEventListener('change', () => {
      rule.enabled = enabled.checked;
      save();
      patterns.classList.toggle('text-base-content/45', !rule.enabled);
    });

    const patternCell = append(row, 'td', 'py-4 align-middle');
    const patterns = append(patternCell, 'div', `space-y-0.5 ${rule.enabled ? '' : 'text-base-content/45'}`);
    rule.patterns.forEach((pattern) => append(patterns, 'code', 'block break-all font-mono text-[11px] leading-[1.7]', pattern));

    const environmentCell = append(row, 'td', 'py-4 align-middle');
    const environment = append(environmentCell, 'select', 'select select-sm w-full bg-base-100 text-xs');
    environment.replaceChildren(...Object.entries(ENVIRONMENTS).map(([value, { label }]) => new Option(label, value)));
    environment.value = rule.environment;
    environment.setAttribute('aria-label', `规则 ${index + 1} 的代理环境`);
    environment.addEventListener('change', () => {
      rule.environment = environment.value;
      save();
    });

    const machineCell = append(row, 'td', 'py-4 align-middle');
    const machine = append(machineCell, 'select', 'select select-sm w-full bg-base-100 text-xs');
    populateMachines(machine, rule.machine);
    machine.setAttribute('aria-label', `规则 ${index + 1} 的测试机`);
    machine.addEventListener('change', () => {
      if (machine.value === ADD_MACHINE) {
        machine.value = rule.machine;
        openMachine({ ruleIndex: index });
      } else {
        rule.machine = machine.value;
        save();
      }
    });

    const actions = append(append(row, 'td', 'py-4 pr-5 align-middle'), 'div', 'flex justify-end gap-3');
    const edit = append(actions, 'button', 'text-xs text-base-content/60 hover:underline', '编辑');
    edit.setAttribute('aria-label', `编辑规则 ${index + 1}`);
    edit.addEventListener('click', () => openRule(index));
    const remove = append(actions, 'button', 'text-xs text-base-content/45 hover:text-error', '删除');
    remove.setAttribute('aria-label', `删除规则 ${index + 1}`);
    remove.addEventListener('click', () => {
      config.rules.splice(index, 1);
      save();
      render();
      const nextRemove = table.querySelectorAll('button[aria-label^="删除规则"]')[Math.min(index, config.rules.length - 1)];
      (nextRemove ?? element('add-rule')).focus();
    });
  });
  if (!config.rules.length) {
    const empty = append(append(table, 'tr'), 'td', 'py-12 text-center text-sm text-base-content/45', '还没有规则，点击“新增规则”开始配置。');
    empty.colSpan = 5;
  }
}

element('add-rule').addEventListener('click', () => openRule());

element('rule-form').addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const rule = validateRule({
      enabled: element('rule-enabled').checked,
      patterns: element('rule-patterns').value.split(/\r?\n/u).map((pattern) => pattern.trim()).filter(Boolean),
      environment: element('rule-environment').value,
      machine: element('rule-machine').value,
    }, config.machines);
    if (editedRule === null) config.rules.push(rule);
    else config.rules[editedRule] = rule;
    save();
    render();
    element('rule-dialog').close();
    const savedIndex = editedRule === null ? config.rules.length - 1 : editedRule;
    element('rules-table').querySelectorAll('button[aria-label^="编辑规则"]')[savedIndex]?.focus();
  } catch (error) {
    inputError('rule-error', error.message);
  }
});

element('rule-machine').addEventListener('change', () => {
  if (element('rule-machine').value === ADD_MACHINE) {
    element('rule-machine').value = draftMachine;
    openMachine({ form: true });
  } else {
    draftMachine = element('rule-machine').value;
  }
});

element('machine-form').addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const machine = normalizeMachine(element('machine-input').value);
    if (!config.machines.includes(machine)) config.machines.push(machine);
    if (machineTarget?.form) {
      draftMachine = machine;
      populateMachines(element('rule-machine'), machine);
    }
    else if (machineTarget) config.rules[machineTarget.ruleIndex].machine = machine;
    save();
    render();
    element('machine-dialog').close();
    if (machineTarget?.form) element('rule-machine').focus();
    else if (machineTarget) element('rules-table').rows[machineTarget.ruleIndex]?.querySelectorAll('select')[1]?.focus();
  } catch (error) {
    inputError('machine-error', error.message);
  }
});

element('apply-button').addEventListener('click', () => notice('演示应用完成。未连接或修改真实 Whistle。'));

element('open-connection').addEventListener('click', () => {
  element('connection-input').value = config.whistle.url;
  inputError('connection-error');
  element('connection-dialog').showModal();
});

element('connection-form').addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    config.whistle.url = normalizeUrl(element('connection-input').value);
    save();
    render();
    element('connection-dialog').close();
  } catch (error) {
    inputError('connection-error', error.message);
  }
});

document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => element(button.dataset.close).close()));

element('import-button').addEventListener('click', () => {
  element('import-file').value = '';
  element('import-file').click();
});

element('import-file').addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    if (!window.jsyaml) throw new Error('YAML 功能暂未加载，请检查网络后刷新。');
    pendingImport = validateConfig(window.jsyaml.load(await file.text(), { schema: window.jsyaml.JSON_SCHEMA }));
    element('import-summary').textContent = `${file.name}：包含 ${pendingImport.rules.length} 条规则、${pendingImport.machines.length} 台测试机。`;
    element('import-dialog').showModal();
  } catch (error) {
    pendingImport = null;
    notice(`导入失败：${error.message}`, true);
  }
});

element('confirm-import').addEventListener('click', () => {
  if (!pendingImport) return;
  config = pendingImport;
  pendingImport = null;
  const saved = save();
  render();
  element('import-dialog').close();
  if (saved) notice('配置已导入，未向 Whistle 发送请求。');
});

element('export-button').addEventListener('click', () => {
  if (!window.jsyaml) {
    notice('YAML 功能暂未加载，请检查网络后刷新。', true);
    return;
  }
  const yaml = window.jsyaml.dump(config, { noRefs: true, lineWidth: -1, quotingType: '"' });
  const url = URL.createObjectURL(new Blob([yaml], { type: 'application/yaml;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'nlab-easy-whistle.yaml';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notice('配置已导出为 nlab-easy-whistle.yaml。');
});

render();
