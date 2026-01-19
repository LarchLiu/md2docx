<script>
  const data = templateData;
</script>

<div class="my-component">Hello md2x! This is svelte template</div>
{#each data as item, index}
  <div>
    <h2>{item.title}</h2>
    <p>{item.message}</p>
  </div>
{/each}

<style>
  .my-component {
    color: red;
  }
</style>

