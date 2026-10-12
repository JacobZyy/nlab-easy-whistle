<script setup lang="ts" vapor>
import { nextTick, useTemplateRef } from 'vue';
import type { Environment, ProxyRule } from '../rule-config';

const props = defineProps<{ rules: ProxyRule[]; machines: string[]; disabled: boolean }>();
const emit = defineEmits<{
  change: [index: number, rule: ProxyRule];
  edit: [index: number];
  remove: [index: number];
  copy: [index: number];
  addMachine: [index: number];
}>();
const table = useTemplateRef<HTMLTableElement>('table');

function setEnabled(index: number, event: Event) {
  const rule = props.rules[index];
  if (rule && !props.disabled) emit('change', index, { ...rule, enabled: (event.target as HTMLInputElement).checked });
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
  <div class="overflow-hidden rounded-lg border border-base-300">
    <table ref="table" class="table w-full table-fixed" aria-label="代理规则配置">
      <colgroup><col class="w-[76px]" /><col class="w-[144px]" /><col /><col class="w-[156px]" /><col class="w-[205px]" /><col class="w-[152px]" /></colgroup>
      <thead class="bg-base-200/80 text-xs font-normal text-base-content/75">
        <tr><th class="py-3 pl-5 font-normal">启用</th><th class="font-normal">名称</th><th class="font-normal">请求匹配规则</th><th class="font-normal">代理环境</th><th class="font-normal">测试机</th><th class="pr-5 text-right font-normal">操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="(rule, index) in rules" :key="index" class="border-base-300/70">
          <td class="py-4 pl-5 align-middle"><input type="checkbox" class="toggle toggle-sm toggle-success" :checked="rule.enabled" :disabled="disabled" :aria-label="`启用规则 ${index + 1}：${rule.patterns[0]}`" @change="setEnabled(index, $event)" /></td>
          <td class="break-words py-4 align-middle text-xs" :class="{ 'text-base-content/75': !rule.enabled }">{{ rule.name }}</td>
          <td class="py-4 align-middle"><div class="space-y-0.5" :class="{ 'text-base-content/75': !rule.enabled }"><code v-for="pattern in rule.patterns" :key="pattern" class="block break-all font-mono text-[11px] leading-[1.7]">{{ pattern }}</code></div></td>
          <td class="py-4 align-middle"><select class="select select-sm w-full bg-base-100 text-xs" :value="rule.environment" :disabled="disabled" :aria-label="`规则 ${index + 1} 的代理环境`" @change="setEnvironment(index, $event)"><option value="test">测试环境</option><option value="sandbox">沙箱环境</option></select></td>
          <td class="py-4 align-middle"><select class="select select-sm w-full bg-base-100 text-xs" :disabled="disabled" :aria-label="`规则 ${index + 1} 的测试机`" @change="setMachine(index, $event)"><option v-for="machine in machines" :key="machine" :value="machine" :selected="machine === rule.machine">{{ machine }}</option><option value="">＋ 新增测试机…</option></select></td>
          <td class="py-4 pr-5 align-middle"><div class="flex justify-end gap-3"><button class="text-xs text-base-content/75 hover:underline disabled:opacity-40" :disabled="disabled" :aria-label="`复制规则 ${index + 1}`" @click="emit('copy', index)">复制</button><button class="text-xs text-base-content/75 hover:underline disabled:opacity-40" :disabled="disabled" :aria-label="`编辑规则 ${index + 1}`" @click="emit('edit', index)">编辑</button><button data-remove class="text-xs text-base-content/75 hover:text-error disabled:opacity-40" :disabled="disabled" :aria-label="`删除规则 ${index + 1}`" @click="removeRule(index)">删除</button></div></td>
        </tr>
        <tr v-if="!rules.length"><td colspan="6" class="py-12 text-center text-sm text-base-content/75">还没有规则，点击“新增规则”开始配置。</td></tr>
      </tbody>
    </table>
  </div>
</template>
