import { describe, expect, it } from 'vitest';
import { historyBriefFromJson } from './historyBrief.js';

describe('historyBriefFromJson', () => {
  it('reads completion and the first output image without the prompt body', () => {
    const brief = historyBriefFromJson(
      {
        'job-1': {
          prompt: [{ huge: true }],
          outputs: {
            '9': {
              images: [
                { filename: 'WCG_00001_.png', subfolder: '', type: 'output' },
              ],
            },
          },
          status: { completed: true, status_str: 'success' },
        },
      },
      'job-1',
    );
    expect(brief).toEqual({
      completed: true,
      statusStr: 'success',
      image: {
        filename: 'WCG_00001_.png',
        subfolder: '',
        type: 'output',
      },
    });
  });

  it('treats a missing job as not finished', () => {
    expect(historyBriefFromJson({}, 'job-1')).toEqual({
      completed: false,
      statusStr: null,
      image: null,
    });
  });
});
