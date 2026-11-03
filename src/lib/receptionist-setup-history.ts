// Register before Next hydrates: popstate listeners on window run in
// registration order, including capture listeners on the event's target.
export const SETUP_HISTORY_EVENT = 'flowrish:setup-history'
export const SETUP_HISTORY_SCRIPT = `(function(){
  if(window.__flowrishSetupHistoryBridge)return;
  window.__flowrishSetupHistoryBridge=true;
  window.addEventListener('popstate',function(event){
    window.dispatchEvent(new CustomEvent('flowrish:setup-history',{detail:event}));
  });
})();`
