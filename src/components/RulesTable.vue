<script setup lang="ts" vapor>
import { nextTick, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue';
import type { Environment, ProxyRule } from '../rule-config';

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
  if (rule && !props.disabled) emit('change', index, { ...rule, environment: (event.target as HTMLSelectElement).value as Environment });
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
  <div class="overflow-x-auto rounded-lg border border-base-300 backdrop-blur-sm">
    <p id="rule-sort-help" class="sr-only">拖动排序手柄调整规则顺序，也可聚焦手柄后按上、下方向键移动。</p>
    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ announcement }}</p>
    <table ref="table" class="table w-full table-fixed" aria-label="代理规则配置">
      <colgroup><col class="w-[48px]" /><col class="w-[112px]" /><col class="w-[144px]" /><col /><col class="w-[156px]" /><col class="w-[205px]" /><col class="w-[152px]" /></colgroup>
      <thead class="text-xs font-normal text-base-content/75">
        <tr><th class="px-2 py-3 font-normal"><span class="sr-only">排序</span></th><th class="px-2 font-normal">状态</th><th class="font-normal">名称</th><th class="font-normal">请求匹配规则</th><th class="font-normal">代理环境</th><th class="font-normal">测试机</th><th class="pr-5 text-right font-normal">操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="(rule, index) in rules" :key="index" :data-rule-index="index" class="border-base-300/70" :class="{ 'outline-2 -outline-offset-2 outline-primary': dropIndex === index && draggedIndex !== index }">
          <td class="border-l-4 px-1.5 py-4 align-middle" :class="rule.enabled ? 'border-l-success' : 'border-l-neutral'">
            <button type="button" data-drag-handle class="btn btn-ghost btn-sm btn-square touch-none select-none [-webkit-user-select:none] text-base-content/70" :class="draggedIndex === index ? 'cursor-grabbing bg-base-300' : 'cursor-grab'" :disabled="disabled || rules.length < 2" :aria-label="`调整规则 ${index + 1} 的顺序：${rule.name || rule.patterns[0]}，拖动或按上、下方向键排序`" aria-describedby="rule-sort-help" title="拖动排序，或按上、下方向键移动" @pointerdown="startDrag(index, $event)" @pointermove="dragOver" @pointerup="finishDrag" @pointercancel="cancelDrag" @lostpointercapture="cancelDrag" @keydown="moveWithKeyboard(index, $event)">
              <svg aria-hidden="true" viewBox="0 0 16 20" class="h-5 w-4 fill-current"><circle cx="5" cy="4" r="1.5" /><circle cx="11" cy="4" r="1.5" /><circle cx="5" cy="10" r="1.5" /><circle cx="11" cy="10" r="1.5" /><circle cx="5" cy="16" r="1.5" /><circle cx="11" cy="16" r="1.5" /></svg>
            </button>
          </td>
          <td class="px-2 py-4 align-middle">
            <button type="button" class="btn btn-sm min-w-24 gap-2 font-semibold" :class="rule.enabled ? 'btn-success' : 'btn-neutral'" :disabled="disabled" :aria-pressed="rule.enabled" :aria-label="`启用规则 ${index + 1}：${rule.patterns[0]}`" :title="rule.enabled ? '点击禁用' : '点击启用'" @click="toggleEnabled(index)">
              <svg v-if="rule.enabled" aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4 fill-none stroke-current" stroke-width="2.5"><path d="m3 8 3 3 7-7" /></svg>
              <svg v-else aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4 fill-current"><rect x="4" y="3" width="3" height="10" rx="1" /><rect x="9" y="3" width="3" height="10" rx="1" /></svg>
              {{ rule.enabled ? '已启用' : '已禁用' }}
            </button>
          </td>
          <td class="break-words py-4 align-middle text-xs" :class="{ 'text-base-content/75': !rule.enabled }">{{ rule.name }}</td>
          <td class="py-4 align-middle"><div class="space-y-0.5" :class="{ 'text-base-content/75': !rule.enabled }"><code v-for="pattern in rule.patterns" :key="pattern" class="block break-all font-mono text-[11px] leading-[1.7]">{{ pattern }}</code></div></td>
          <td class="py-4 align-middle"><select class="select select-sm w-full bg-base-100 text-xs" :value="rule.environment" :disabled="disabled" :aria-label="`规则 ${index + 1} 的代理环境`" @change="setEnvironment(index, $event)"><option value="test">测试环境</option><option value="sandbox">沙箱环境</option></select></td>
          <td class="py-4 align-middle"><select class="select select-sm w-full bg-base-100 text-xs" :disabled="disabled" :aria-label="`规则 ${index + 1} 的测试机`" @change="setMachine(index, $event)"><option v-for="machine in machines" :key="machine" :value="machine" :selected="machine === rule.machine">{{ machine }}</option><option value="">＋ 新增测试机…</option></select></td>
          <td class="py-4 pr-5 align-middle"><div class="flex justify-end gap-3"><button class="text-xs text-base-content/75 hover:underline disabled:opacity-40" :disabled="disabled" :aria-label="`复制规则 ${index + 1}`" @click="emit('copy', index)">复制</button><button class="text-xs text-base-content/75 hover:underline disabled:opacity-40" :disabled="disabled" :aria-label="`编辑规则 ${index + 1}`" @click="emit('edit', index)">编辑</button><button data-remove class="text-xs text-base-content/75 hover:text-error disabled:opacity-40" :disabled="disabled" :aria-label="`删除规则 ${index + 1}`" @click="removeRule(index)">删除</button></div></td>
        </tr>
        <tr v-if="!rules.length"><td colspan="7" class="py-12 text-center text-sm text-base-content/75">还没有规则，点击“新增规则”开始配置。</td></tr>
      </tbody>
    </table>
  </div>
</template>
