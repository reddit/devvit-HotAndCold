import { Devvit } from '@devvit/public-api';
import { ChallengeToPost } from '../core/challengeToPost.js';
import { ChallengeService } from '../core/challenge.js';

Devvit.addTrigger({
  event: 'CommentSubmit',
  onEvent: async (event, context) => {
    if (!event.comment) {
      console.error('No comment found in event', event);
      return;
    }
    if (!event.post?.id) {
      console.error('No post found in event', event);
      return;
    }

    // TODO: we need to eventually getChallengeInfoForPost and have it return both number & mode.
    const info = await ChallengeToPost.getChallengeNumberForPost({
      redis: context.redis,
      postId: event.post.id,
    });

    const challengeInfo = await new ChallengeService(context.redis).getChallenge({
      challenge: info,
    });

    const comment = await context.reddit.getCommentById(event.comment.id);

    if (comment.body.includes(challengeInfo.word)) {
      console.log(`Comment contains the word: ${challengeInfo.word}. Deleting comment...`);

      try {
        await comment.remove(true);
      } catch (error) {
        console.error(`Error deleting comment:`, error);
      }
    }
  },
});
