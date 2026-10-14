<script setup lang="ts" vapor>
import { computed, nextTick, onUnmounted, ref, shallowRef, useTemplateRef } from 'vue';
import { dump, JSON_SCHEMA, load } from 'js-yaml';
import { generateRules, normalizeMachine, normalizeUrl, validateConfig, validateRule, type ProxyRule, type RuleConfig } from '../rule-config';
import { applyWhistleRules, WHISTLE_RULE_NAME } from '../whistle-client';
import { exportYaml } from '../config-export';
import { useRuleConfig } from '../composables/useRuleConfig';
import RuleEditor from './RuleEditor.vue';
import RulesTable from './RulesTable.vue';
import RulePreview from './RulePreview.vue';

type NoticeKind = 'success' | 'warning' | 'error';
const notice = shallowRef<{ message: string; kind: NoticeKind } | null>(null);
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

function showNotice(message: string, kind: NoticeKind = 'success') {
  clearTimeout(noticeTimer);
  notice.value = { message, kind };
  if (kind === 'success') noticeTimer = setTimeout(() => { notice.value = null; }, 4500);
}

onUnmounted(() => clearTimeout(noticeTimer));
const { config, replaceConfig } = useRuleConfig((message) => showNotice(message, 'warning'));
const ruleText = computed(() => generateRules(config.value));
const preview = useTemplateRef<{ selectText(index?: number): void }>('preview');
const busy = shallowRef(false);
const exporting = shallowRef(false);
const editorOpen = shallowRef(false);
const editedIndex = shallowRef<number | null>(null);
const editedRule = computed(() => editedIndex.value === null ? null : config.value.rules[editedIndex.value] ?? null);
const ruleEditor = useTemplateRef<{ selectMachine(machine: string): void }>('ruleEditor');
const addButton = useTemplateRef<HTMLButtonElement>('addButton');
const importFile = useTemplateRef<HTMLInputElement>('importFile');
const machineDialog = useTemplateRef<HTMLDialogElement>('machineDialog');
const machineInput = useTemplateRef<HTMLInputElement>('machineInput');
const connectionDialog = useTemplateRef<HTMLDialogElement>('connectionDialog');
const importDialog = useTemplateRef<HTMLDialogElement>('importDialog');
const machineName = shallowRef('');
const machineError = shallowRef('');
const connectionUrl = shallowRef('');
const connectionError = shallowRef('');
const importedConfig = ref<RuleConfig | null>(null);
const importName = shallowRef('');
let machineTarget: number | 'editor' = 'editor';

function openRule(index: number | null = null) {
  if (busy.value) return;
  editedIndex.value = index;
  editorOpen.value = true;
}

function saveRule(rule: ProxyRule) {
  if (busy.value) return;
  if (editedIndex.value === null) config.value.rules.push(rule);
  else config.value.rules[editedIndex.value] = rule;
  editorOpen.value = false;
}

function changeRule(index: number, rule: ProxyRule) {
  if (!busy.value) config.value.rules[index] = validateRule(rule, config.value.machines);
}

function moveRule(from: number, to: number) {
  if (busy.value || from === to) return;
  const rules = config.value.rules;
  const rule = rules[from];
  if (!rule || to < 0 || to >= rules.length) return;
  rules.splice(from, 1);
  rules.splice(to, 0, rule);
}

function removeRule(index: number) {
  if (busy.value) return;
  config.value.rules.splice(index, 1);
  if (!config.value.rules.length) nextTick(() => addButton.value?.focus());
}

function openMachine(target: number | 'editor') {
  if (busy.value) return;
  machineTarget = target;
  machineName.value = '';
  machineError.value = '';
  machineDialog.value?.showModal();
  nextTick(() => machineInput.value?.focus());
}

function saveMachine() {
  if (busy.value) return;
  try {
    const machine = normalizeMachine(machineName.value);
    if (!config.value.machines.includes(machine)) config.value.machines.push(machine);
    if (machineTarget === 'editor') ruleEditor.value?.selectMachine(machine);
    else {
      const rule = config.value.rules[machineTarget];
      if (rule) config.value.rules[machineTarget] = validateRule({ ...rule, machine }, config.value.machines);
    }
    machineDialog.value?.close();
  } catch (cause) {
    machineError.value = cause instanceof Error ? cause.message : '测试机无法保存。';
  }
}

function openConnection() {
  if (busy.value) return;
  connectionUrl.value = config.value.whistle.url;
  connectionError.value = '';
  connectionDialog.value?.showModal();
}

function saveConnection() {
  if (busy.value) return;
  try {
    config.value.whistle.url = normalizeUrl(connectionUrl.value);
    connectionDialog.value?.close();
  } catch (cause) {
    connectionError.value = cause instanceof Error ? cause.message : 'Whistle 地址无法保存。';
  }
}

function chooseImport() {
  if (busy.value || !importFile.value) return;
  importFile.value.value = '';
  importFile.value.click();
}

async function readImport(event: Event) {
  if (busy.value) return;
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const yaml = await file.text();
    if (busy.value) return;
    importedConfig.value = validateConfig(load(yaml, { schema: JSON_SCHEMA }));
    importName.value = file.name;
    importDialog.value?.showModal();
  } catch (cause) {
    showNotice(`导入失败：${cause instanceof Error ? cause.message : '配置格式无效。'}`, 'error');
  }
}

function confirmImport() {
  if (busy.value || !importedConfig.value) return;
  replaceConfig(importedConfig.value);
  importDialog.value?.close();
  showNotice('配置已导入。点击“应用”后才会写入 Whistle。');
}

async function exportConfig() {
  if (busy.value || exporting.value) return;
  exporting.value = true;
  try {
    const yaml = dump(validateConfig(config.value), { noRefs: true, lineWidth: -1, quotingType: '"' });
    if (await exportYaml(yaml)) showNotice('配置已导出。');
  } catch (cause) {
    showNotice(`导出失败：${cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '无法保存配置。'}`, 'error');
  } finally {
    exporting.value = false;
  }
}

async function copyRules(index?: number) {
  const text = index === undefined ? ruleText.value : generateRules({ ...config.value, rules: config.value.rules.slice(index, index + 1) });
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showNotice(index === undefined ? '全部规则已复制。' : '规则已复制。');
  } catch {
    preview.value?.selectText(index);
    showNotice('无法访问剪贴板，已选中规则文本，可手动复制。', 'warning');
  }
}

async function applyRules() {
  if (busy.value) return;
  busy.value = true;
  try {
    const snapshot = validateConfig(config.value);
    const result = await applyWhistleRules(snapshot.whistle.url, generateRules(snapshot));
    const warning = result.disabled ? 'Whistle 全局规则已禁用。' : '';
    showNotice(`“${WHISTLE_RULE_NAME}”已保存并启用，回读确认。${warning}`, warning ? 'warning' : 'success');
  } catch (cause) {
    showNotice(cause instanceof Error ? cause.message : '无法应用规则。', 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="mx-auto max-w-[1280px] px-8 pt-8 pb-10 antialiased">
    <header class="mb-6 flex items-center justify-between gap-5 rounded-box border-b-4 border-secondary bg-neutral px-6 py-5 text-neutral-content">
      <h1 class="flex items-center gap-3 text-xl font-semibold tracking-tight"><img src="/favicon.png" alt="" class="size-9 rounded-field" />NLab Easy Whistle</h1>
      <div class="flex items-center gap-2">
        <button class="btn btn-sm bg-base-100 font-normal" :disabled="busy" @click="chooseImport">导入 YAML</button>
        <button class="btn btn-sm bg-base-100 font-normal" :disabled="busy || exporting" @click="exportConfig">导出 YAML</button>
        <button ref="addButton" class="btn btn-secondary btn-sm ml-1 font-semibold" :disabled="busy" aria-haspopup="dialog" @click="openRule()">＋ 新增规则</button>
        <input ref="importFile" type="file" accept=".yaml,.yml,text/yaml,application/yaml" class="hidden" aria-label="选择 YAML 配置文件" :disabled="busy" @change="readImport" />
      </div>
    </header>

    <RulesTable :rules="config.rules" :machines="config.machines" :disabled="busy" @change="changeRule" @move="moveRule" @edit="openRule" @remove="removeRule" @copy="copyRules" @add-machine="openMachine" />

    <footer class="mt-5 flex items-center justify-between gap-4 rounded-field bg-base-100/85 px-4 py-3">
      <button class="btn btn-ghost h-auto min-h-0 p-0 text-xs font-normal text-base-content/75 hover:bg-transparent" :disabled="busy" aria-haspopup="dialog" @click="openConnection">Whistle：<span class="font-mono">{{ config.whistle.url }}</span><span class="ml-1 underline underline-offset-2">设置</span></button>
      <button class="btn btn-primary btn-sm px-5 font-medium" :disabled="busy" :aria-busy="busy" @click="applyRules">{{ busy ? '应用中…' : '应用' }}</button>
    </footer>

    <RulePreview ref="preview" :text="ruleText" @copy="copyRules()" />
  </main>

  <RuleEditor ref="ruleEditor" :open="editorOpen" :rule="editedRule" :machines="config.machines" :disabled="busy" @save="saveRule" @close="editorOpen = false" @add-machine="openMachine('editor')" />

  <dialog ref="machineDialog" class="modal" aria-labelledby="machine-title">
    <div class="modal-box max-w-sm p-6"><h2 id="machine-title" class="text-base font-semibold">新增测试机</h2><form class="mt-5" @submit.prevent="saveMachine"><label for="machine-input" class="mb-2 block text-xs font-medium">测试机名称</label><input id="machine-input" ref="machineInput" v-model="machineName" class="input input-sm w-full" placeholder="例如 jacobzy" autocomplete="off" :disabled="busy" required /><p v-if="machineError" class="mt-2 text-xs text-error" role="alert">{{ machineError }}</p><div class="modal-action mt-5"><button type="button" class="btn btn-sm" @click="machineDialog?.close()">取消</button><button class="btn btn-sm" type="submit" :disabled="busy">保存并选择</button></div></form></div>
    <form method="dialog" class="modal-backdrop"><button aria-label="关闭新增测试机窗口">关闭</button></form>
  </dialog>

  <dialog ref="connectionDialog" class="modal" aria-labelledby="connection-title">
    <div class="modal-box max-w-md p-6"><h2 id="connection-title" class="text-base font-semibold">Whistle 地址</h2><form class="mt-5" @submit.prevent="saveConnection"><label for="connection-input" class="mb-2 block text-xs font-medium">HTTP 地址</label><input id="connection-input" v-model="connectionUrl" class="input input-sm w-full font-mono text-sm" type="url" placeholder="http://127.0.0.1:8899" :disabled="busy" required autofocus /><p v-if="connectionError" class="mt-2 text-xs text-error" role="alert">{{ connectionError }}</p><div class="modal-action mt-5"><button type="button" class="btn btn-sm" @click="connectionDialog?.close()">取消</button><button class="btn btn-sm" type="submit" :disabled="busy">保存地址</button></div></form></div>
    <form method="dialog" class="modal-backdrop"><button aria-label="关闭 Whistle 地址窗口">关闭</button></form>
  </dialog>

  <dialog ref="importDialog" class="modal" aria-labelledby="import-title">
    <div class="modal-box max-w-md p-6"><h2 id="import-title" class="text-base font-semibold">导入配置</h2><p class="mt-4 break-all text-sm leading-6 text-base-content/75">{{ importName }}：包含 {{ importedConfig?.rules.length ?? 0 }} 条规则、{{ importedConfig?.machines.length ?? 0 }} 台测试机。</p><p class="mt-2 text-xs leading-5 text-base-content/75">替换当前应用的本地配置。点击“应用”后才会写入 Whistle。</p><div class="modal-action mt-5"><button class="btn btn-sm" @click="importDialog?.close()">取消</button><button class="btn btn-sm" :disabled="busy" @click="confirmImport">替换配置</button></div></div>
    <form method="dialog" class="modal-backdrop"><button aria-label="关闭导入配置窗口">关闭</button></form>
  </dialog>

  <div v-if="notice" class="toast toast-bottom toast-center z-50" :role="notice.kind === 'error' ? 'alert' : 'status'" :aria-live="notice.kind === 'error' ? 'assertive' : 'polite'">
    <div class="flex max-w-2xl items-start gap-4 rounded-lg border bg-base-100 px-5 py-3 text-sm shadow-sm" :class="{ 'border-error/30 text-error': notice.kind === 'error', 'border-warning/30 text-base-content': notice.kind === 'warning', 'border-base-300 text-base-content': notice.kind === 'success' }"><p class="whitespace-pre-wrap break-words">{{ notice.message }}</p><button class="shrink-0 px-1 text-base-content/75" aria-label="关闭提示" @click="notice = null">×</button></div>
  </div>
</template>
