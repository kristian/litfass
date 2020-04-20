"use strict";

// this is a VERY "flaky" scheduler, by design! this means events are always scheduled to the full next second,
// where all events at the same second are executed at once. this way the litfaß will not "stutter" between
// multiple displays even if it runs for a very long time, due to asynchronized setTimestamp calls
module.exports = class Scheduler {
    constructor() {
        this.schedule = new Map();

        this.pendingTimeouts = new Map();
        this.pendingImmediates = new Map();
    }

    sleep(delay, callback) {
        return new Promise((resolve, reject) => {
            if (delay > 0) {
                let timeoutId;
                this.pendingTimeouts.set(timeoutId = setTimeout(() => {
                    this.pendingTimeouts.delete(timeoutId); resolve();
                }, delay), reject);
            } else {
                let immediateId;
                this.pendingImmediates.set(immediateId = setImmediate(() => {
                    this.pendingImmediates.delete(immediateId); resolve();
                }), reject);
            }
        }).then(callback);
    }

    scheduleIn(delay, task, offset) {
        // calculate the future time slot, when the event should be triggered
        const time = Math.ceil((Date.now() + delay) / 1e3), timeSlot = time + ((offset | 0) / 1e3);
    
        // check if there is a schedule for this time slot already
        let batch = this.schedule.get(timeSlot);
        
        // if there is no schedule yet, create one as close to the full second calculated as possible
        if (!batch) {
            const tasks = [];
            this.schedule.set(timeSlot, batch = {
                tasks, promise: this.sleep((timeSlot * 1e3) - Date.now(), async () => {
                    await Promise.all(tasks.map(task => task())); // execute all tasks in parallel
                    this.schedule.delete(timeSlot);
                })
            });
        }
    
        // append the task to the schedules tasks list
        batch.tasks.push(task);
    
        // return the promise this schedule is waiting for
        return batch.promise;
    }

    close() {
        const reason = 'Sleep interrupt. The scheduler was closed and all pending timeouts have been cancelled.';
        this.pendingTimeouts.forEach((reject, timeoutId) => { clearTimeout(timeoutId); reject(reason); });
        this.pendingImmediates.forEach((reject, immediateId) => { clearImmediate(immediateId); reject(reason); });
        this.schedule.clear(); this.pendingTimeouts.clear(); this.pendingImmediates.clear();
    }
}