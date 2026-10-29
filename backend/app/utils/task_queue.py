"""In-process background task queue with status tracking.

Used to run long provisioning jobs (minutes of RPA polling) off the request
thread. Tasks are NOT retried automatically by default: provisioning steps
create real records in external systems, so a blind retry could duplicate them.
"""

import logging
import queue
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

logger = logging.getLogger(__name__)
_HISTORY_LIMIT = 200


class TaskStatus(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCESS = "SUCCESS"
    RETRYING = "RETRYING"
    FAILED = "FAILED"


@dataclass
class Task:
    name: str
    func: Callable[..., Any]
    args: tuple = ()
    kwargs: dict = field(default_factory=dict)
    max_retries: int = 0
    initial_delay: float = 2.0
    backoff_factor: float = 2.0
    id: str = field(default_factory=lambda: f"task-{uuid.uuid4().hex[:8]}")
    status: TaskStatus = TaskStatus.QUEUED
    attempts: int = 0
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    completed_at: float | None = None
    error: str | None = None
    result: Any = None
    next_retry_at: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        def fmt(ts: float | None) -> str | None:
            return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts)) if ts else None

        duration = (
            round(self.completed_at - self.started_at, 2) if self.completed_at and self.started_at else None
        )
        return {
            "id": self.id,
            "name": self.name,
            "status": self.status.value,
            "attempts": self.attempts,
            "maxRetries": self.max_retries,
            "createdAt": fmt(self.created_at),
            "startedAt": fmt(self.started_at),
            "completedAt": fmt(self.completed_at),
            "durationSec": duration,
            "error": self.error,
        }


class TaskQueue:
    def __init__(self, num_workers: int = 3):
        self._queue: queue.Queue[Task] = queue.Queue()
        self._num_workers = num_workers
        self._tasks: dict[str, Task] = {}
        self._order: list[str] = []
        self._lock = threading.Lock()
        self._workers: list[threading.Thread] = []
        self._running = False
        self._metrics = {"totalEnqueued": 0, "totalSuccess": 0, "totalFailed": 0, "totalRetried": 0}

    # --------------------------------------------------------------- lifecycle
    def start(self) -> None:
        if self._running:
            return
        self._running = True
        for index in range(self._num_workers):
            worker = threading.Thread(target=self._worker_loop, name=f"hr-worker-{index + 1}", daemon=True)
            worker.start()
            self._workers.append(worker)
        logger.info("Task queue started with %d workers.", self._num_workers)

    def stop(self) -> None:
        self._running = False

    # ------------------------------------------------------------------ public
    def enqueue(self, name: str, func: Callable[..., Any], *args: Any, max_retries: int = 0, **kwargs: Any) -> str:
        task = Task(name=name, func=func, args=args, kwargs=kwargs, max_retries=max_retries)
        with self._lock:
            self._tasks[task.id] = task
            self._order.insert(0, task.id)
            if len(self._order) > _HISTORY_LIMIT:
                self._tasks.pop(self._order.pop(), None)
            self._metrics["totalEnqueued"] += 1
        self._queue.put(task)
        logger.info("Enqueued task %s (%s)", task.name, task.id)
        return task.id

    def get_task(self, task_id: str) -> dict[str, Any] | None:
        with self._lock:
            task = self._tasks.get(task_id)
            return task.to_dict() if task else None

    def list_tasks(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            return [self._tasks[i].to_dict() for i in self._order[:limit] if i in self._tasks]

    def get_metrics(self) -> dict[str, Any]:
        with self._lock:
            return {
                **self._metrics,
                "activeWorkers": sum(1 for w in self._workers if w.is_alive()),
                "pendingQueueSize": self._queue.qsize(),
                "historyCount": len(self._tasks),
            }

    # ----------------------------------------------------------------- workers
    def _worker_loop(self) -> None:
        while self._running:
            try:
                task = self._queue.get(timeout=1.0)
            except queue.Empty:
                continue
            try:
                if task.next_retry_at > time.time():
                    time.sleep(max(0.1, min(1.0, task.next_retry_at - time.time())))
                    self._queue.put(task)
                else:
                    self._execute(task)
            finally:
                self._queue.task_done()

    def _execute(self, task: Task) -> None:
        task.attempts += 1
        task.status = TaskStatus.RUNNING
        task.started_at = task.started_at or time.time()
        try:
            task.result = task.func(*task.args, **task.kwargs)
        except Exception as exc:  # noqa: BLE001 - a worker must never die
            task.error = str(exc)
            logger.exception("Task %s (%s) failed on attempt %d", task.name, task.id, task.attempts)
            if task.attempts <= task.max_retries:
                delay = task.initial_delay * (task.backoff_factor ** (task.attempts - 1))
                task.status = TaskStatus.RETRYING
                task.next_retry_at = time.time() + delay
                with self._lock:
                    self._metrics["totalRetried"] += 1
                self._queue.put(task)
            else:
                task.status = TaskStatus.FAILED
                task.completed_at = time.time()
                with self._lock:
                    self._metrics["totalFailed"] += 1
        else:
            task.status = TaskStatus.SUCCESS
            task.completed_at = time.time()
            task.error = None
            with self._lock:
                self._metrics["totalSuccess"] += 1
