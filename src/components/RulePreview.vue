<script setup lang="ts" vapor>
import { computed, useTemplateRef } from 'vue';
import { tokenizeRule, type RuleToken } from '../rule-highlight';

const props = defineProps<{ text: string }>();
const emit = defineEmits<{ copy: [] }>();
const lines = computed(() => props.text ? props.text.split('\n').map(tokenizeRule) : []);
const preview = useTemplateRef<HTMLPreElement>('preview');
const code = useTemplateRef<HTMLElement>('code');
const tokenColors: Record<RuleToken['kind'], string> = {
  plain: '',
  comment: 'text-base-content/60 italic',
  operator: 'text-info',
  address: 'text-warning',
  key: 'text-secondary',
  string: 'text-primary',
};

function selectText(index?: number) {
  const element = index === undefined ? code.value : code.value?.querySelectorAll('[data-rule-line]')[index];
  if (!element) return;
  preview.value?.focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

defineExpose({ selectText });
</script>

<template>
  <section class="mt-8" aria-labelledby="preview-title">
    <div class="mb-3 flex items-center gap-3">
      <h2 id="preview-title" class="text-sm font-medium">规则文本预览</h2>
      <button class="btn btn-ghost btn-xs font-normal" :disabled="!text" @click="emit('copy')">复制全部规则</button>
    </div>
    <pre ref="preview" data-theme="night" class="max-h-80 overflow-auto rounded-box border border-base-300 bg-base-100 p-5 font-mono text-xs leading-6 text-base-content outline-none focus-visible:ring-2 focus-visible:ring-primary" tabindex="0" aria-label="规则代码"><code ref="code"><template v-if="text"><template v-for="(tokens, index) in lines" :key="index"><span data-rule-line><span v-for="(token, tokenIndex) in tokens" :key="tokenIndex" :class="tokenColors[token.kind]">{{ token.text }}</span></span>{{ index < lines.length - 1 ? '\n' : '' }}</template></template><span v-else class="text-base-content/60">暂无规则</span></code></pre>
  </section>
</template>
