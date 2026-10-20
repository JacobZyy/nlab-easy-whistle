<script setup lang="ts" vapor>
import { nextTick, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue';
import { ENVIRONMENTS, type Environment, type ProxyRule } from '../rule-config';

const props = defineProps<{ rules: ProxyRule[]; machines: string[]; disabled: boolean }>();
const emit = defineEmits<{
  change: [index: number, rule: ProxyRule];
  edit: [index: number];
  remove: [index: number];
  copy: [index: number];
  addMachine: [index: number];
  move: [from: number, to: number];
}>();
const table = useTemplateRef<HTMLTableElement>('table');
const draggedIndex = shallowRef<number | null>(null);
const dropIndex = shallowRef<number | null>(null);
const announcement = shallowRef('');
let pointerId: number | null = null;
let dragHandle: HTMLButtonElement | null = null;

function cancelDrag() {
  const handle = dragHandle;
  const pointer = pointerId;
  draggedIndex.value = null;
  dropIndex.value = null;
  pointerId = null;
  dragHandle = null;
  if (handle && pointer !== null && handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
}

watch(() => props.disabled, (disabled) => {
  if (disabled) cancelDrag();
});
onUnmounted(cancelDrag);

function rowAtPointer(event: PointerEvent) {
  const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLTableRowElement>('tr[data-rule-index]');
  if (!row || row.closest('table') !== table.value) return null;
  return Number(row.dataset.ruleIndex);
}

function startDrag(index: number, event: PointerEvent) {
  if (props.disabled || props.rules.length < 2 || event.button !== 0 || !event.isPrimary) return;
  cancelDrag();
  event.preventDefault();
  dragHandle = event.currentTarget as HTMLButtonElement;
  pointerId = event.pointerId;
  draggedIndex.value = index;
  dropIndex.value = index;
  dragHandle.focus();
  dragHandle.setPointerCapture(event.pointerId);
}

function dragOver(event: PointerEvent) {
  if (event.pointerId === pointerId) dropIndex.value = rowAtPointer(event);
}

async function moveRule(from: number, to: number) {
  if (props.disabled || from === to || to < 0 || to >= props.rules.length) return;
  const rule = props.rules[from];
  if (!rule) return;
  announcement.value = '';
  emit('move', from, to);
  await nextTick();
  table.value?.querySelectorAll<HTMLButtonElement>('button[data-drag-handle]')[to]?.focus();
  announcement.value = `规则“${rule.name || rule.patterns[0]}”已移动到第 ${to + 1} 条，共 ${props.rules.length} 条。`;
}

function finishDrag(event: PointerEvent) {
  if (event.pointerId !== pointerId) return;
  const from = draggedIndex.value;
  const to = rowAtPointer(event);
  cancelDrag();
  if (from !== null && to !== null) void moveRule(from, to);
}

function moveWithKeyboard(index: number, event: KeyboardEvent) {
  if (event.key === 'Escape') {
    cancelDrag();
    return;
  }
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  cancelDrag();
  void moveRule(index, index + (event.key === 'ArrowUp' ? -1 : 1));
}

function toggleEnabled(index: number) {
  const rule = props.rules[index];
  if (rule && !props.disabled) emit('change', index, { ...rule, enabled: !rule.enabled });
}

function setEnvironment(index: number, event: Event) {
  const rule = props.rules[index];
  if (!rule || props.disabled) return;
  const environment = (event.target as HTMLSelectElement).value as Environment;
  emit('change', index, { ...rule, environment, port: rule.port ?? 8000, machine: rule.machine || props.machines[0] || '' });
}

function setPort(index: number, event: Event) {
  const rule = props.rules[index];
  if (!rule || props.disabled) return;
  const input = event.target as HTMLInputElement;
  if (!input.reportValidity()) {
    input.value = String(rule.port);
    return;
  }
  emit('change', index, { ...rule, port: input.valueAsNumber });
}

function setMachine(index: number, event: Event) {
  const rule = props.rules[index];
  if (!rule || props.disabled) return;
  const select = event.target as HTMLSelectElement;
  if (!select.value) {
    select.value = rule.machine;
    emit('addMachine', index);
  } else {
    emit('change', index, { ...rule, machine: select.value });
  }
}

async function removeRule(index: number) {
  if (props.disabled) return;
  emit('remove', index);
  await nextTick();
  table.value?.querySelectorAll<HTMLButtonElement>('button[data-remove]')[Math.min(index, props.rules.length - 1)]?.focus();
}
</script>

<template>
  <div class="min-h-0 min-w-0 overflow-auto overscroll-contain rounded-box border border-base-300 bg-base-100/85 backdrop-blur-sm" tabindex="0" role="region" aria-label="代理规则配置列表">
    <p id="rule-sort-help" class="sr-only">拖动排序手柄调整规则顺序，也可聚焦手柄后按上、下方向键移动。</p>
    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ announcement }}</p>
    <table ref="table" class="table w-full min-w-[600px] table-fixed" aria-label="代理规则配置">
      <colgroup><col class="w-[32px]" /><col class="w-[60px]" /><col /><col class="w-[256px]" /><col class="w-[96px]" /></colgroup>
      <thead class="sticky top-0 z-10 bg-base-100 text-xs font-normal text-base-content/75">
        <tr><th scope="col" class="px-1 py-2 font-normal"><span class="sr-only">排序</span></th><th scope="col" class="px-1 py-2 font-normal">状态</th><th scope="col" class="px-2 py-2 font-normal">名称 / 请求匹配规则</th><th scope="col" class="px-2 py-2 font-normal">代理目标</th><th scope="col" class="px-2 py-2 text-right font-normal">操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="(rule, index) in rules" :key="index" :data-rule-index="index" class="border-base-300/70" :class="{ 'outline-2 -outline-offset-2 outline-primary': dropIndex === index && draggedIndex !== index }">
          <td class="border-l-4 px-0 py-1.5 align-middle" :class="rule.enabled ? 'border-l-success' : 'border-l-neutral'">
            <button type="button" data-drag-handle class="btn btn-ghost btn-xs btn-square touch-none select-none [-webkit-user-select:none] text-base-content/70" :class="draggedIndex === index ? 'cursor-grabbing bg-base-300' : 'cursor-grab'" :disabled="disabled || rules.length < 2" :aria-label="`调整规则 ${index + 1} 的顺序：${rule.name || rule.patterns[0]}，拖动或按上、下方向键排序`" aria-describedby="rule-sort-help" title="拖动排序，或按上、下方向键移动" @pointerdown="startDrag(index, $event)" @pointermove="dragOver" @pointerup="finishDrag" @pointercancel="cancelDrag" @lostpointercapture="cancelDrag" @keydown="moveWithKeyboard(index, $event)">
              <svg aria-hidden="true" viewBox="0 0 16 20" class="h-5 w-4 fill-current"><circle cx="5" cy="4" r="1.5" /><circle cx="11" cy="4" r="1.5" /><circle cx="5" cy="10" r="1.5" /><circle cx="11" cy="10" r="1.5" /><circle cx="5" cy="16" r="1.5" /><circle cx="11" cy="16" r="1.5" /></svg>
            </button>
          </td>
          <td class="px-1 py-1.5 text-center align-middle">
            <button type="button" class="btn btn-xs btn-square" :class="rule.enabled ? 'btn-success' : 'btn-neutral'" :disabled="disabled" :aria-pressed="rule.enabled" :aria-label="`启用规则 ${index + 1}：${rule.patterns[0]}`" :title="rule.enabled ? '已启用，点击禁用' : '已禁用，点击启用'" @click="toggleEnabled(index)">
              <svg v-if="rule.enabled" aria-hidden="true" viewBox="0 0 16 16" class="size-3.5 fill-none stroke-current" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8 3 3 7-7" /></svg>
              <svg v-else aria-hidden="true" viewBox="0 0 16 16" class="size-3.5 fill-current"><rect x="4" y="3" width="3" height="10" rx="1" /><rect x="9" y="3" width="3" height="10" rx="1" /></svg>
            </button>
          </td>
          <td class="px-2 py-1.5 align-middle">
            <div class="min-w-0 space-y-0.5" :class="{ 'text-base-content/75': !rule.enabled }"><p v-if="rule.name" class="break-words text-xs leading-4 font-medium">{{ rule.name }}</p><code v-for="pattern in rule.patterns" :key="pattern" class="block break-all font-mono text-[11px] leading-4">{{ pattern }}</code></div>
          </td>
          <td class="px-2 py-1.5 align-middle">
            <div class="flex items-center gap-3">
              <select class="select select-xs h-6 w-[92px] shrink-0 bg-base-100 px-2 text-xs" :disabled="disabled" :aria-label="`规则 ${index + 1} 的代理环境`" @change="setEnvironment(index, $event)"><option v-for="(environment, value) in ENVIRONMENTS" :key="value" :value="value" :selected="value === rule.environment">{{ environment.label }}</option></select>
              <input v-if="rule.environment === 'local'" class="input input-xs h-6 min-w-0 flex-1 bg-base-100 px-2 text-xs" type="number" min="1" max="65535" step="1" required :value="rule.port" :disabled="disabled" :aria-label="`规则 ${index + 1} 的本地端口`" @change="setPort(index, $event)" />
              <select v-else class="select select-xs h-6 min-w-0 flex-1 bg-base-100 px-2 text-xs" :disabled="disabled" :aria-label="`规则 ${index + 1} 的测试机`" @change="setMachine(index, $event)"><option v-for="machine in machines" :key="machine" :value="machine" :selected="machine === rule.machine">{{ machine }}</option><option value="">＋ 新增测试机…</option></select>
            </div>
          </td>
          <td class="px-2 py-1.5 align-middle">
            <div class="flex justify-end gap-1">
              <button type="button" class="btn btn-ghost btn-xs btn-square text-base-content/75" :disabled="disabled" :aria-label="`复制规则 ${index + 1}`" title="复制规则" @click="emit('copy', index)"><svg aria-hidden="true" viewBox="0 0 24 24" class="size-3.5 fill-none stroke-current" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg></button>
              <button type="button" class="btn btn-ghost btn-xs btn-square text-base-content/75" :disabled="disabled" :aria-label="`编辑规则 ${index + 1}`" title="编辑规则" @click="emit('edit', index)"><svg aria-hidden="true" viewBox="0 0 24 24" class="size-3.5 fill-none stroke-current" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z" /></svg></button>
              <button type="button" data-remove class="btn btn-ghost btn-xs btn-square text-base-content/75 hover:text-error" :disabled="disabled" :aria-label="`删除规则 ${index + 1}`" title="删除规则" @click="removeRule(index)"><svg aria-hidden="true" viewBox="0 0 24 24" class="size-3.5 fill-none stroke-current" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></svg></button>
            </div>
          </td>
        </tr>
        <tr v-if="!rules.length"><td colspan="5" class="py-12 text-center text-sm text-base-content/75">还没有规则，点击“新增规则”开始配置。</td></tr>
      </tbody>
    </table>
  </div>
</template>
