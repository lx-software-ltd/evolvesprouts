import 'package:material_ui/material_ui.dart';

class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Evolve Sprouts',
      debugShowCheckedModeBanner: false,
      home: const Scaffold(
        body: Center(
          child: Text('Evolve Sprouts App'),
        ),
      ),
    );
  }
}
