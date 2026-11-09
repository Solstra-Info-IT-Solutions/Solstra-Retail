import { SetMetadata } from '@nestjs/common';
export const SKIP_TRIAL_KEY = 'skipTrial';
export const SkipTrial = () => SetMetadata(SKIP_TRIAL_KEY, true);
