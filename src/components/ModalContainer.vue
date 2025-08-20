<script setup lang="ts">
const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  content: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['close'])
</script>

<template>
  <div
    id="modalContainer"
    class="fixed inset-0 flex justify-center items-center bg-black bg-opacity-60 z-30"
  >
    <div id="modalContent" class="bg-white p-6 rounded-xl shadow-xl w-11/12 max-w-3xl relative">
      <span
        id="closeModalButton"
        @click="emit('close')"
        class="absolute top-2 right-4 text-3xl font-bold cursor-pointer text-gray-400 hover:text-gray-700"
      >
        &times;
      </span>

      <h2 id="modalTitle" class="text-2xl font-bold mb-4 text-gray-800">
        {{ title }}
      </h2>

      <div id="modalBody">
        <slot>
          <div v-html="content"></div>
        </slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
#modalContent {
  max-height: 90vh;
  overflow-y: auto;
}
</style>
