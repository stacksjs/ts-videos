/**
 * Batch processing utilities for video operations
 *
 * Provides tools for processing multiple files with
 * concurrency control, progress tracking, and error handling.
 */

export interface BatchJob<T = unknown> {
  id: string
  input: string
  output?: string
  options?: T
  status: BatchJobStatus
  progress: number
  error?: Error
  startTime?: number
  endTime?: number
  result?: unknown
}

export type BatchJobStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped'

export interface BatchOptions<T = unknown> {
  concurrency?: number
  retries?: number
  retryDelay?: number
  continueOnError?: boolean
  skipExisting?: boolean
  dryRun?: boolean
  timeout?: number
  onProgress?: (job: BatchJob<T>, overall: BatchProgress) => void
  onJobStart?: (job: BatchJob<T>) => void
  onJobComplete?: (job: BatchJob<T>) => void
  onJobError?: (job: BatchJob<T>, error: Error) => void
  beforeJob?: (job: BatchJob<T>) => Promise<boolean>
  afterJob?: (job: BatchJob<T>) => Promise<void>
}

export interface BatchProgress {
  total: number
  completed: number
  failed: number
  skipped: number
  running: number
  pending: number
  percent: number
  eta?: number
  avgTimePerJob?: number
}

export interface BatchResult<T = unknown> {
  jobs: BatchJob<T>[]
  summary: BatchSummary
}

export interface BatchSummary {
  total: number
  completed: number
  failed: number
  skipped: number
  cancelled: number
  totalTime: number
  avgTimePerJob: number
  errors: Array<{ jobId: string, error: Error }>
}

export interface FilePattern {
  directory: string
  pattern: string | RegExp
  recursive?: boolean
  exclude?: string | RegExp
}

export type ProcessFunction<T, R = unknown> = (
  job: BatchJob<T>,
  signal?: AbortSignal
) => Promise<R>

/**
 * Batch processor class for handling multiple jobs
 */
export class BatchProcessor<T = unknown> {
  private jobs: Map<string, BatchJob<T>> = new Map()
  private queue: string[] = []
  private running: Set<string> = new Set()
  private options: Required<BatchOptions<T>>
  private abortController: AbortController | null = null
  private startTime: number = 0
  private completedTimes: number[] = []

  constructor(options: BatchOptions<T> = {}) {
    this.options = {
      concurrency: options.concurrency ?? 4,
      retries: options.retries ?? 0,
      retryDelay: options.retryDelay ?? 1000,
      continueOnError: options.continueOnError ?? true,
      skipExisting: options.skipExisting ?? false,
      dryRun: options.dryRun ?? false,
      timeout: options.timeout ?? 0,
      onProgress: options.onProgress ?? (() => {}),
      onJobStart: options.onJobStart ?? (() => {}),
      onJobComplete: options.onJobComplete ?? (() => {}),
      onJobError: options.onJobError ?? (() => {}),
      beforeJob: options.beforeJob ?? (async () => true),
      afterJob: options.afterJob ?? (async () => {}),
    }
  }

  /**
   * Add a job to the batch
   */
  addJob(input: string, output?: string, jobOptions?: T): string {
    const id = `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

    const job: BatchJob<T> = {
      id,
      input,
      output,
      options: jobOptions,
      status: 'pending',
      progress: 0,
    }

    this.jobs.set(id, job)
    this.queue.push(id)

    return id
  }

  /**
   * Add multiple jobs at once
   */
  addJobs(jobs: Array<{ input: string, output?: string, options?: T }>): string[] {
    return jobs.map(j => this.addJob(j.input, j.output, j.options))
  }

  /**
   * Get job by ID
   */
  getJob(id: string): BatchJob<T> | undefined {
    return this.jobs.get(id)
  }

  /**
   * Get all jobs
   */
  getAllJobs(): BatchJob<T>[] {
    return Array.from(this.jobs.values())
  }

  /**
   * Get current progress
   */
  getProgress(): BatchProgress {
    const jobs = this.getAllJobs()
    const total = jobs.length
    const completed = jobs.filter(j => j.status === 'completed').length
    const failed = jobs.filter(j => j.status === 'failed').length
    const skipped = jobs.filter(j => j.status === 'skipped').length
    const running = jobs.filter(j => j.status === 'running').length
    const pending = jobs.filter(j => j.status === 'pending' || j.status === 'queued').length

    const percent = total > 0 ? ((completed + failed + skipped) / total) * 100 : 0

    let eta: number | undefined
    let avgTimePerJob: number | undefined

    if (this.completedTimes.length > 0) {
      avgTimePerJob = this.completedTimes.reduce((a, b) => a + b, 0) / this.completedTimes.length
      const remaining = pending + running
      eta = remaining * avgTimePerJob
    }

    return {
      total,
      completed,
      failed,
      skipped,
      running,
      pending,
      percent,
      eta,
      avgTimePerJob,
    }
  }

  /**
   * Process all jobs with the given function
   */
  async process(processFn: ProcessFunction<T>): Promise<BatchResult<T>> {
    this.abortController = new AbortController()
    this.startTime = Date.now()
    this.completedTimes = []

    // Mark all jobs as queued
    for (const id of this.queue) {
      const job = this.jobs.get(id)
      if (job)
        job.status = 'queued'
    }

    // Process queue with concurrency
    const results = await this.processQueue(processFn)

    const endTime = Date.now()
    const totalTime = endTime - this.startTime

    const jobs = this.getAllJobs()
    const errors = jobs
      .filter(j => j.status === 'failed' && j.error)
      .map(j => ({ jobId: j.id, error: j.error! }))

    const summary: BatchSummary = {
      total: jobs.length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      skipped: jobs.filter(j => j.status === 'skipped').length,
      cancelled: jobs.filter(j => j.status === 'cancelled').length,
      totalTime,
      avgTimePerJob: this.completedTimes.length > 0
        ? this.completedTimes.reduce((a, b) => a + b, 0) / this.completedTimes.length
        : 0,
      errors,
    }

    return { jobs, summary }
  }

  /**
   * Cancel all running and pending jobs
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort()
    }

    for (const job of this.jobs.values()) {
      if (job.status === 'pending' || job.status === 'queued' || job.status === 'running') {
        job.status = 'cancelled'
      }
    }
  }

  /**
   * Clear all jobs
   */
  clear(): void {
    this.jobs.clear()
    this.queue = []
    this.running.clear()
    this.completedTimes = []
  }

  private async processQueue(processFn: ProcessFunction<T>): Promise<void> {
    const promises: Promise<void>[] = []

    while (this.queue.length > 0 || this.running.size > 0) {
      // Check if cancelled
      if (this.abortController?.signal.aborted) {
        break
      }

      // Start new jobs if we have capacity
      while (this.running.size < this.options.concurrency && this.queue.length > 0) {
        const jobId = this.queue.shift()
        if (jobId) {
          const promise = this.processJob(jobId, processFn)
          promises.push(promise)
        }
      }

      // Wait a bit before checking again
      if (this.running.size >= this.options.concurrency || this.queue.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    await Promise.allSettled(promises)
  }

  private async processJob(jobId: string, processFn: ProcessFunction<T>): Promise<void> {
    const job = this.jobs.get(jobId)
    if (!job)
      return

    // Check if we should skip
    if (this.options.skipExisting && job.output) {
      try {
        const file = Bun.file(job.output)
        if (await file.exists()) {
          job.status = 'skipped'
          this.options.onProgress(job, this.getProgress())
          return
        }
      }
      catch {
        // File doesn't exist, continue processing
      }
    }

    // Run beforeJob hook
    try {
      const shouldProcess = await this.options.beforeJob(job)
      if (!shouldProcess) {
        job.status = 'skipped'
        this.options.onProgress(job, this.getProgress())
        return
      }
    }
    catch (error) {
      job.status = 'failed'
      job.error = error instanceof Error ? error : new Error(String(error))
      this.options.onJobError(job, job.error)
      return
    }

    // Mark as running
    job.status = 'running'
    job.startTime = Date.now()
    this.running.add(jobId)
    this.options.onJobStart(job)
    this.options.onProgress(job, this.getProgress())

    let attempts = 0
    const maxAttempts = this.options.retries + 1

    while (attempts < maxAttempts) {
      try {
        // Check if cancelled
        if (this.abortController?.signal.aborted) {
          job.status = 'cancelled'
          break
        }

        // Dry run - simulate processing
        if (this.options.dryRun) {
          await new Promise(resolve => setTimeout(resolve, 100))
          job.status = 'completed'
          job.progress = 100
          break
        }

        // Create timeout signal if needed
        let signal = this.abortController?.signal
        if (this.options.timeout > 0) {
          const timeoutController = new AbortController()
          const timeoutId = setTimeout(() => timeoutController.abort(), this.options.timeout)

          // Combine signals
          signal = timeoutController.signal
          this.abortController?.signal.addEventListener('abort', () => {
            clearTimeout(timeoutId)
            timeoutController.abort()
          })
        }

        // Process the job
        job.result = await processFn(job, signal)
        job.status = 'completed'
        job.progress = 100
        break
      }
      catch (error) {
        attempts++
        job.error = error instanceof Error ? error : new Error(String(error))

        if (attempts < maxAttempts) {
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, this.options.retryDelay))
        }
        else {
          job.status = 'failed'
          this.options.onJobError(job, job.error)

          if (!this.options.continueOnError) {
            this.cancel()
          }
        }
      }
    }

    job.endTime = Date.now()
    this.running.delete(jobId)

    if (job.status === 'completed') {
      this.completedTimes.push(job.endTime - job.startTime!)
      this.options.onJobComplete(job)

      // Run afterJob hook
      try {
        await this.options.afterJob(job)
      }
      catch {
        // Ignore afterJob errors
      }
    }

    this.options.onProgress(job, this.getProgress())
  }
}

/**
 * Find files matching a pattern
 */
export async function findFiles(pattern: FilePattern): Promise<string[]> {
  const files: string[] = []
  const glob = new Bun.Glob(
    typeof pattern.pattern === 'string' ? pattern.pattern : '**/*'
  )

  for await (const file of glob.scan({
    cwd: pattern.directory,
    absolute: true,
    onlyFiles: true,
  })) {
    // Check regex pattern if provided
    if (pattern.pattern instanceof RegExp && !pattern.pattern.test(file)) {
      continue
    }

    // Check exclude pattern
    if (pattern.exclude) {
      if (typeof pattern.exclude === 'string' && file.includes(pattern.exclude)) {
        continue
      }
      if (pattern.exclude instanceof RegExp && pattern.exclude.test(file)) {
        continue
      }
    }

    files.push(file)
  }

  return files
}

/**
 * Generate output path for a batch job
 */
export function generateOutputPath(
  inputPath: string,
  outputDir?: string,
  suffix?: string,
  extension?: string
): string {
  const parts = inputPath.split('/')
  const filename = parts.pop() || 'output'
  const dir = outputDir || parts.join('/')

  const lastDot = filename.lastIndexOf('.')
  const baseName = lastDot > 0 ? filename.substring(0, lastDot) : filename
  const ext = extension || (lastDot > 0 ? filename.substring(lastDot) : '')

  const outputName = suffix ? `${baseName}${suffix}${ext}` : `${baseName}${ext}`

  return `${dir}/${outputName}`
}

/**
 * Create a batch from a directory
 */
export async function createBatchFromDirectory<T = unknown>(
  directory: string,
  options: {
    pattern?: string | RegExp
    recursive?: boolean
    exclude?: string | RegExp
    outputDir?: string
    outputSuffix?: string
    outputExtension?: string
    jobOptions?: T | ((input: string) => T)
  } = {}
): Promise<BatchProcessor<T>> {
  const files = await findFiles({
    directory,
    pattern: options.pattern || '*',
    recursive: options.recursive ?? true,
    exclude: options.exclude,
  })

  const processor = new BatchProcessor<T>()

  for (const file of files) {
    const output = generateOutputPath(
      file,
      options.outputDir,
      options.outputSuffix,
      options.outputExtension
    )

    const jobOptions = typeof options.jobOptions === 'function'
      ? (options.jobOptions as (input: string) => T)(file)
      : options.jobOptions

    processor.addJob(file, output, jobOptions)
  }

  return processor
}

/**
 * Create a simple batch processing pipeline
 */
export async function batchProcess<T = unknown, R = unknown>(
  inputs: Array<{ input: string, output?: string, options?: T }>,
  processFn: ProcessFunction<T, R>,
  batchOptions: BatchOptions<T> = {}
): Promise<BatchResult<T>> {
  const processor = new BatchProcessor<T>(batchOptions)
  processor.addJobs(inputs)
  return processor.process(processFn)
}

/**
 * Utility to format progress for display
 */
export function formatProgress(progress: BatchProgress): string {
  const { total, completed, failed, skipped, running, percent, eta } = progress

  let status = `${completed}/${total} completed`
  if (failed > 0)
    status += `, ${failed} failed`
  if (skipped > 0)
    status += `, ${skipped} skipped`
  if (running > 0)
    status += ` (${running} running)`

  status += ` - ${percent.toFixed(1)}%`

  if (eta !== undefined) {
    status += ` - ETA: ${formatTime(eta)}`
  }

  return status
}

/**
 * Format time in ms to human readable string
 */
export function formatTime(ms: number): string {
  if (ms < 1000)
    return `${ms}ms`
  if (ms < 60000)
    return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}m ${seconds}s`
  }
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  return `${hours}h ${minutes}m`
}

/**
 * Create a progress bar string
 */
export function createProgressBar(
  percent: number,
  width: number = 40,
  filled: string = '█',
  empty: string = '░'
): string {
  const filledCount = Math.round((percent / 100) * width)
  const emptyCount = width - filledCount
  return filled.repeat(filledCount) + empty.repeat(emptyCount)
}

/**
 * Batch job reporter for console output
 */
export class BatchReporter<T = unknown> {
  private lastLine: string = ''

  constructor(private options: { clearLine?: boolean, verbose?: boolean } = {}) {
    this.options.clearLine = options.clearLine ?? true
    this.options.verbose = options.verbose ?? false
  }

  onProgress(job: BatchJob<T>, progress: BatchProgress): void {
    const bar = createProgressBar(progress.percent)
    const status = formatProgress(progress)
    const line = `[${bar}] ${status}`

    if (this.options.clearLine && process.stdout.isTTY) {
      process.stdout.write(`\r${line}`)
    }
    else if (line !== this.lastLine) {
      console.log(line)
    }

    this.lastLine = line
  }

  onJobStart(job: BatchJob<T>): void {
    if (this.options.verbose) {
      console.log(`\nStarting: ${job.input}`)
    }
  }

  onJobComplete(job: BatchJob<T>): void {
    if (this.options.verbose) {
      const time = job.endTime && job.startTime
        ? formatTime(job.endTime - job.startTime)
        : 'unknown'
      console.log(`\nCompleted: ${job.input} (${time})`)
    }
  }

  onJobError(job: BatchJob<T>, error: Error): void {
    console.error(`\nFailed: ${job.input} - ${error.message}`)
  }

  printSummary(result: BatchResult<T>): void {
    console.log('\n')
    console.log('='.repeat(50))
    console.log('Batch Processing Summary')
    console.log('='.repeat(50))
    console.log(`Total jobs: ${result.summary.total}`)
    console.log(`Completed: ${result.summary.completed}`)
    console.log(`Failed: ${result.summary.failed}`)
    console.log(`Skipped: ${result.summary.skipped}`)
    console.log(`Cancelled: ${result.summary.cancelled}`)
    console.log(`Total time: ${formatTime(result.summary.totalTime)}`)
    console.log(`Avg time per job: ${formatTime(result.summary.avgTimePerJob)}`)

    if (result.summary.errors.length > 0) {
      console.log('\nErrors:')
      for (const { jobId, error } of result.summary.errors) {
        console.log(`  ${jobId}: ${error.message}`)
      }
    }
    console.log('='.repeat(50))
  }
}

export default {
  BatchProcessor,
  BatchReporter,
  findFiles,
  generateOutputPath,
  createBatchFromDirectory,
  batchProcess,
  formatProgress,
  formatTime,
  createProgressBar,
}
