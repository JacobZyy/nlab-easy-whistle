<script setup lang="ts" vapor>
import { nextTick, reactive, shallowRef, useTemplateRef, watch } from 'vue';
import { validateRule, type Environment, type ProxyRule } from '../rule-config';

const props = defineProps<{ open: boolean; rule: ProxyRule | null; machines: string[]; disabled: boolean }>();
const emit = defineEmits<{ save: [rule: ProxyRule]; close: []; addMachine: [] }>();
const dialog = useTemplateRef<HTMLDialogElement>('dialog');
const patternsInput = useTemplateRef<HTMLTextAreaElement>('patternsInput');
const machineSelect = useTemplateRef<HTMLSelectElement>('machineSelect');
const error = shallowRef('');
const draft = reactive({ name: '', enabled: true, patterns: '', environment: 'test' as Environment, machine: '' });

watch(() => props.open, async (open) => {
  if (!open) {
    dialog.value?.close();
    return;
  }
  const rule = props.rule;
  draft.name = rule?.name ?? '';
  draft.enabled = rule?.enabled ?? true;
  draft.patterns = rule?.patterns.join('\n') ?? '';
  draft.environment = rule?.environment ?? 'test';
  draft.machine = rule?.machine ?? props.machines[0] ?? '';
  error.value = '';
  await nextTick();
  if (props.open && dialog.value && !dialog.value.open) {
    dialog.value.showModal();
    patternsInput.value?.focus();
  }
}, { immediate: true });

function setMachine(event: Event) {
  const select = event.target as HTMLSelectElement;
  if (!select.value) {
    select.value = draft.machine;
    emit('addMachine');
  } else {
    draft.machine = select.value;
  }
}

function selectMachine(machine: string) {
  draft.machine = machine;
  nextTick(() => machineSelect.value?.focus());
}

function saveRule() {
  if (props.disabled) return;
  try {
    emit('save', validateRule({
      name: draft.name,
      enabled: draft.enabled,
      patterns: draft.patterns.split(/\r?\n/u).map((pattern) => pattern.trim()).filter(Boolean),
      environment: draft.environment,
      machine: draft.machine,
    }, props.machines));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '规则无法保存。';
  }
}

defineExpose({ selectMachine });
</script>

<template>
  <dialog ref="dialog" class="modal" aria-labelledby="rule-title" @close="emit('close')">
    <div class="modal-box max-w-xl p-6">
      <h2 id="rule-title" class="text-base font-semibold">{{ rule ? '编辑规则' : '新增规则' }}</h2>
      <form class="mt-5" @submit.prevent="saveRule">
        <fieldset class="m-0 min-w-0 border-0 p-0" :disabled="disabled">
          <label for="rule-name" class="mb-2 block text-xs font-medium">名称</label>
          <input id="rule-name" v-model="draft.name" class="input input-sm w-full" placeholder="可留空" />
          <label for="rule-patterns" class="mt-4 mb-2 block text-xs font-medium">请求匹配规则 <span class="font-normal text-base-content/75">每行一项</span></label>
          <textarea id="rule-patterns" ref="patternsInput" v-model="draft.patterns" class="textarea h-36 w-full resize-y font-mono text-xs leading-6" placeholder="*/your_service&#10;*/u/your_service" required></textarea>
          <div class="mt-4 grid grid-cols-2 gap-4">
            <div><label for="rule-environment" class="mb-2 block text-xs font-medium">代理环境</label><select id="rule-environment" v-model="draft.environment" class="select select-sm w-full"><option value="test">测试环境</option><option value="sandbox">沙箱环境</option></select></div>
            <div><label for="rule-machine" class="mb-2 block text-xs font-medium">测试机</label><select id="rule-machine" ref="machineSelect" class="select select-sm w-full" @change="setMachine"><option v-for="machine in machines" :key="machine" :value="machine" :selected="machine === draft.machine">{{ machine }}</option><option value="">＋ 新增测试机…</option></select></div>
          </div>
          <label class="mt-5 flex w-fit cursor-pointer items-center gap-2.5 text-xs"><input v-model="draft.enabled" type="checkbox" class="toggle toggle-sm toggle-success" />启用这条规则</label>
          <p v-if="error" class="mt-3 text-xs text-error" role="alert">{{ error }}</p>
          <div class="modal-action mt-6"><button type="button" class="btn btn-sm" @click="dialog?.close()">取消</button><button class="btn btn-sm" type="submit">保存规则</button></div>
        </fieldset>
      </form>
    </div>
    <form method="dialog" class="modal-backdrop"><button aria-label="关闭规则编辑窗口">关闭</button></form>
  </dialog>
</template>
