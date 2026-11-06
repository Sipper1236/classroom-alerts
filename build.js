// Release stamp: bump the build ID whenever shipped scripts change, even at the same version.
(() => {
  const build=Object.freeze({"version":"0.8.0","id":"0.8.0-r4","protocol":1});
  globalThis.ClassroomBuild=build;
  if(typeof module!=='undefined')module.exports=build;
})();
