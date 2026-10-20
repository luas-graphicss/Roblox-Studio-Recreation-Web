export function createVisibilitySampleRecordPool() {


  const recordStorage = [];
  const frameRecordList = [];
  let usedRecordCount = 0;

  function createRecord() {
    return {
      sampleIndex: 0,
      gridX: 0,
      gridY: 0,
      fullX: 0,
      fullY: 0,
      slotIndex: 0,
      lightIndex: 0,
      sourcePointU: 0,
      sourcePointV: 0,
      originView: { x: 0, y: 0, z: 0 },
      normalView: { x: 0, y: 0, z: 0 },
      coverage: 0,
    };
  }

  function beginFrame() {
    usedRecordCount = 0;
    frameRecordList.length = 0;
  }


  function nextRecord() {
    let record = recordStorage[usedRecordCount];
    if (!record) {
      record = createRecord();
      recordStorage[usedRecordCount] = record;
    }
    record.sampleIndex = usedRecordCount;
    usedRecordCount += 1;
    frameRecordList.push(record);
    return record;
  }


  function count() {
    return usedRecordCount;
  }


  function frameRecords() {
    return frameRecordList;
  }

  function describe() {
    return {
      pooledRecordCount: recordStorage.length,
      frameRecordCount: usedRecordCount,
    };
  }

  return { beginFrame, nextRecord, count, frameRecords, describe };
}
