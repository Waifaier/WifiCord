// Redesign UI — filtro visual de amigos (não altera lógica de dados existente)
document.addEventListener('DOMContentLoaded', function () {
  var input = document.getElementById('friend-search-input');
  var lists = [document.getElementById('friend-list'), document.getElementById('friend-requests-list')];
  if (!input) return;
  input.addEventListener('input', function () {
    var q = input.value.trim().toLowerCase();
    lists.forEach(function (list) {
      if (!list) return;
      Array.prototype.forEach.call(list.children, function (item) {
        if (item.classList.contains('empty-state') || item.classList.contains('error-state')) return;
        var text = item.textContent.toLowerCase();
        item.style.display = !q || text.indexOf(q) !== -1 ? '' : 'none';
      });
    });
  });
});
