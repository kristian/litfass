// this is a VERY "flaky" schedule, by design! this means close events (by 2 seconds) will be merged
// together into one event, this way the litfaß will not "stutter" between multiple displays even
// if it runs for a very long time, due to un-synchronized setTimestamp calls!
const flakySchedule = new Map();

exports.scheduleIn = (seconds, task) => {
    // calculate the future time slot, when the event should be triggered
    const time = (Date.now() / 1000) + seconds, timeSlot = Math.round(time);

    // check if there is a schedule for this / or the upcoming time slot already
    let promise = flakySchedule.get(timeSlot) || flakySchedule.get(Math.ceil(time));
    
    // if there is no schedule yet, create one as close to the full second calculated as possible
    if (!promise) {
        flakySchedule.set(timeSlot, promise = new Promise((resolve) => {
            setTimeout(resolve, (timeSlot * 1000) - Date.now());
        }));
    }

    // in case a task function as specified, chain it to the promise
    task && promise.then(task);

    // return the promise, which allows more chaining
    return promise;
};