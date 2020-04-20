// this is a VERY "flaky" schedule, by design! this means close events (by 2 seconds) will be merged
// together into one event, this way the litfaß will not "stutter" between multiple displays even
// if it runs for a very long time, due to un-synchronized setTimestamp calls!
const queue = new Map();

const sleep = exports.sleep = (time, callback) => new Promise(resolve => time > 0 ? setTimeout(resolve, time) : setImmediate(resolve)).then(callback);
exports.scheduleIn = (ms, task, offset) => {
    // calculate the future time slot, when the event should be triggered
    const time = Math.ceil((Date.now() + ms) / 1e3), timeSlot = time + ((offset | 0) / 1e3);

    // check if there is a schedule for this time slot already
    let schedule = queue.get(timeSlot);
    
    // if there is no schedule yet, create one as close to the full second calculated as possible
    if (!schedule) {
        const tasks = [];
        queue.set(timeSlot, schedule = {
            tasks, promise: sleep((timeSlot * 1e3) - Date.now()).then(async () => {
                await Promise.all(tasks.map(task => task())); // execute all tasks in parallel
            })
        });        
    }

    // append the task to the schedules tasks list
    schedule.tasks.push(task);

    // return the promise this schedule is waiting for
    return schedule.promise;
};