<!-- Documentation fixture: compile this in a Vue MCP App; it adds no runtime here. -->
<script setup>
import '../elements.css';
defineProps({ label: { type: String, required: true } });
</script>
<template><button class="pi-button">{{ label }}</button></template>
