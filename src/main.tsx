import { Devvit, useAsync } from '@devvit/public-api';
import { DEVVIT_SETTINGS_KEYS } from './constants';

Devvit.addSettings([
  {
    name: DEVVIT_SETTINGS_KEYS.WORD_SERVICE_API_KEY,
    label: 'API Key for Managed Word Service',
    type: 'string',
    isSecret: true,
    scope: 'app',
  },
]);

Devvit.configure({
  redditAPI: true,
  http: true,
  redis: true,
  realtime: true,
});

Devvit.addMenuItem({
  label: 'HotAndCold',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const { reddit, ui } = context;
    const subreddit = await reddit.getCurrentSubreddit();
    await reddit.submitPost({
      title: 'My devvit post',
      subredditName: subreddit.name,
      // The preview appears while the post loads
      preview: (
        <vstack height="100%" width="100%" alignment="middle center">
          <text size="large">Loading ...</text>
        </vstack>
      ),
    });
    ui.showToast({ text: 'Created post!' });
  },
});

// Add a post type definition
Devvit.addCustomPostType({
  name: 'Experience Post',
  height: 'regular',
  render: () => {
    useAsync(async () => {
      return '';
    });

    return (
      <vstack height="100%" width="100%" alignment="center middle">
        <webview
          url="index.html"
          state={{ hello: 'world' }}
          width={'100%'}
          height={'100%'}
          onMessage={(event) => {
            console.log('Received message', event);
          }}
        />
      </vstack>
    );
  },
});

export default Devvit;
